import { createHash } from 'node:crypto';

import type { TransactionScope } from '@cadenway/nest-common/database';
import { eventSchemas } from '@cadenway/contracts/events/document-service';
import type { OutboxWriter } from '@cadenway/nest-messaging/outbox';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { DocumentCreateReceipt } from '../../../../../application/models/document/document-create-receipt.model.js';
import type { DocumentTransaction } from '../../../../../application/models/document/document-transaction.model.js';
import { Document } from '../../../../../domain/aggregates/document/document.aggregate.js';
import type { DocumentFact } from '../../../../../domain/events/document/document-fact.event.js';
import { documentFromRow, documentToRow } from '../../mappers/document/document-row.mapper.js';
import { documentCreateReceipts, documents } from '../../schemas/document/documents.schema.js';

const receiptSnapshot = z.strictObject({
  status: z.literal('active'),
  id: z.uuid(),
  organizationId: z.uuid(),
  spaceId: z.uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  authorUserId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** Maps documents and receipts within one caller-owned tenant transaction. */
export class DrizzleDocumentTransaction implements DocumentTransaction {
  // #region Properties
  /** Selected tenant, checked against the active transaction. */
  private readonly organizationId: string;
  // #endregion

  // #region Constructor
  /** Binds the scoped database and transactional outbox. */
  public constructor(
    private readonly scope: TransactionScope,
    organizationId: string,
    private readonly outbox: Pick<OutboxWriter, 'append'>,
  ) {
    if (
      scope.kind !== 'tenant' ||
      scope.organizationId?.toLowerCase() !== organizationId.toLowerCase()
    ) {
      throw new Error('Document tenant mismatch.');
    }
    this.organizationId = organizationId.toLowerCase();
  }
  // #endregion

  // #region Methods
  /** Allocates a PostgreSQL UUIDv7 inside the owning transaction. */
  public async newId(): Promise<string> {
    const result = await this.scope.db.execute<{ id: string }>(sql`select uuidv7() as id`);
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('Document identifier unavailable.');
    return id;
  }

  /** Locks a document immediately so the Task access decision cannot age on a contended row. */
  public async findAndLock(documentId: string): Promise<Document | null> {
    const [row] = await this.scope.db
      .select()
      .from(documents)
      .where(and(eq(documents.organizationId, this.organizationId), eq(documents.id, documentId)))
      .limit(1)
      .for('update', { noWait: true });
    return row === undefined ? null : documentFromRow(row);
  }

  /** Inserts a newly created document. */
  public async insert(document: Document): Promise<void> {
    const row = documentToRow(document);
    if (row.organizationId.toLowerCase() !== this.organizationId)
      throw new Error('Document tenant mismatch.');
    await this.scope.db.insert(documents).values(row);
  }

  /** Saves a transition while the use case holds the document's row lock. */
  public async save(document: Document): Promise<void> {
    const row = documentToRow(document);
    if (row.organizationId.toLowerCase() !== this.organizationId || row.id === undefined)
      throw new Error('Document tenant mismatch.');
    const updated = await this.scope.db
      .update(documents)
      .set(row)
      .where(and(eq(documents.organizationId, this.organizationId), eq(documents.id, row.id)))
      .returning({ id: documents.id });
    if (updated.length !== 1) throw new Error('Document transition lost its locked row.');
  }

  /** Persists a validated contract fact in the same transaction as its aggregate. */
  public async append(fact: DocumentFact): Promise<void> {
    if (fact.organizationId.toLowerCase() !== this.organizationId)
      throw new Error('Document tenant mismatch.');
    const payload = {
      organizationId: fact.organizationId,
      documentId: fact.documentId,
      spaceId: fact.spaceId,
      actor: { type: 'user' as const, id: fact.actorUserId },
    };
    if (fact.kind === 'created') {
      if (fact.version !== 1) throw new Error('Created document has an invalid version.');
      await this.outbox.append(this.scope, eventSchemas, 'doc.created.v1', {
        ...payload,
        version: 1,
      });
    } else if (fact.kind === 'updated') {
      await this.outbox.append(this.scope, eventSchemas, 'doc.updated.v1', {
        ...payload,
        version: fact.version,
      });
    } else {
      await this.outbox.append(this.scope, eventSchemas, 'doc.deleted.v1', {
        ...payload,
        version: fact.version,
      });
    }
  }

  /** Locks the caller's key even when no receipt exists, then reads an unexpired response. */
  public async findCreateReceipt(
    actorUserId: string,
    key: string,
  ): Promise<DocumentCreateReceipt | 'in-progress' | null> {
    const digest = this.keyDigest(key);
    const locked = await this.scope.db.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${`${this.organizationId}:${actorUserId.toLowerCase()}:${digest}`}, 0)) as acquired`,
    );
    if (locked.rows[0]?.acquired !== true) {
      return 'in-progress';
    }
    const [row] = await this.scope.db
      .select()
      .from(documentCreateReceipts)
      .where(
        and(
          eq(documentCreateReceipts.organizationId, this.organizationId),
          eq(documentCreateReceipts.actorUserId, actorUserId),
          eq(documentCreateReceipts.keyDigest, digest),
          sql`${documentCreateReceipts.expiresAt} > statement_timestamp()`,
        ),
      )
      .limit(1);
    if (row === undefined) return null;
    if (row.snapshot === null) {
      return { fingerprint: row.fingerprint, documentId: row.documentId, document: null };
    }
    const snapshot = receiptSnapshot.parse(row.snapshot);
    if (
      snapshot.organizationId.toLowerCase() !== this.organizationId ||
      snapshot.id !== row.documentId
    )
      throw new Error('Stored document receipt has an invalid binding.');
    return {
      fingerprint: row.fingerprint,
      documentId: row.documentId,
      document: Document.restore({
        ...snapshot,
        createdAt: new Date(snapshot.createdAt),
        updatedAt: new Date(snapshot.updatedAt),
      }).snapshot,
    };
  }

  /** Stores or replaces an expired receipt while the caller's advisory lock is held. */
  public async saveCreateReceipt(
    actorUserId: string,
    key: string,
    receipt: DocumentCreateReceipt,
  ): Promise<void> {
    const snapshot = receipt.document;
    if (
      snapshot?.status !== 'active' ||
      snapshot.organizationId.toLowerCase() !== this.organizationId ||
      snapshot.id !== receipt.documentId
    )
      throw new Error('Document receipt has an invalid binding.');
    const values = {
      organizationId: this.organizationId,
      actorUserId,
      keyDigest: this.keyDigest(key),
      fingerprint: receipt.fingerprint,
      documentId: snapshot.id,
      snapshot: {
        ...snapshot,
        createdAt: snapshot.createdAt.toISOString(),
        updatedAt: snapshot.updatedAt.toISOString(),
      },
      expiresAt: sql`clock_timestamp() + interval '24 hours'`,
    };
    const saved = await this.scope.db
      .insert(documentCreateReceipts)
      .values(values)
      .onConflictDoUpdate({
        target: [
          documentCreateReceipts.organizationId,
          documentCreateReceipts.actorUserId,
          documentCreateReceipts.keyDigest,
        ],
        set: {
          fingerprint: values.fingerprint,
          documentId: values.documentId,
          snapshot: values.snapshot,
          expiresAt: values.expiresAt,
        },
        setWhere: sql`${documentCreateReceipts.expiresAt} <= statement_timestamp()`,
      })
      .returning({ keyDigest: documentCreateReceipts.keyDigest });
    if (saved.length !== 1) throw new Error('Document receipt changed while locked.');
  }

  /** Removes saved body and title while keeping the replay key's deletion fence. */
  public async scrubCreateReceipts(documentId: string): Promise<void> {
    await this.scope.db
      .update(documentCreateReceipts)
      .set({ snapshot: null })
      .where(
        and(
          eq(documentCreateReceipts.organizationId, this.organizationId),
          eq(documentCreateReceipts.documentId, documentId),
        ),
      );
  }

  private keyDigest(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
  }
  // #endregion
}

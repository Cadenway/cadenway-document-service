import { DocumentError } from '../../errors/document/document.error.js';
import type { DocumentFact } from '../../events/document/document-fact.event.js';
import {
  normalizeDocumentTitle,
  validateDocumentBody,
} from '../../policies/document/document-content.policy.js';
import type { DocumentChange } from '../../value-objects/document/document-change.value-object.js';
import type { DocumentSnapshot } from '../../value-objects/document/document-snapshot.value-object.js';

type Creation = Readonly<{
  id: string;
  organizationId: string;
  spaceId: string;
  authorUserId: string;
  title: string;
  body?: string;
  at: Date;
}>;
type Write = Readonly<{ actorUserId: string; expectedVersion: number; at: Date }>;
type Patch = Write & Readonly<{ title?: string; body?: string }>;
type ActiveSnapshot = Extract<DocumentSnapshot, { status: 'active' }>;

const UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeId(value: string, name: string, pattern: RegExp = UUID): string {
  if (value.length !== 36 || !pattern.test(value)) {
    throw new DocumentError('invalid-state', `Invalid document ${name}.`);
  }
  return value.toLowerCase();
}

function validateDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new DocumentError('invalid-state', 'Invalid document timestamp.');
  }
}

/** Owns the published Document lifecycle, including its immutable Task space and ordered versions. */
export class Document {
  // #region Properties
  /** Returns an isolated copy of the current state for storage or response mapping. */
  public get snapshot(): DocumentSnapshot {
    if (this.state.status === 'deleted') {
      return { ...this.state, deletedAt: new Date(this.state.deletedAt) };
    }
    return {
      ...this.state,
      createdAt: new Date(this.state.createdAt),
      updatedAt: new Date(this.state.updatedAt),
    };
  }
  // #endregion

  // #region Constructor
  /** Accepts validated state owned exclusively by this aggregate. */
  private constructor(private readonly state: DocumentSnapshot) {}
  // #endregion

  // #region Methods
  /** Starts at version one under the published create contract. */
  public static create(input: Creation): DocumentChange<DocumentFact> {
    const document = Document.restore({
      status: 'active',
      id: input.id,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      authorUserId: input.authorUserId,
      title: input.title,
      body: input.body ?? '',
      createdAt: input.at,
      updatedAt: input.at,
      version: 1,
    });
    return document.change('created', normalizeId(input.authorUserId, 'author ID'), input.at);
  }

  /** Restores active state or a terminal tombstone without producing a fact. */
  public static restore(snapshot: DocumentSnapshot): Document {
    const identity = {
      id: normalizeId(snapshot.id, 'ID', UUID_V7),
      organizationId: normalizeId(snapshot.organizationId, 'organization ID'),
      spaceId: normalizeId(snapshot.spaceId, 'space ID'),
      version: snapshot.version,
    };

    if (
      !Number.isSafeInteger(identity.version) ||
      identity.version < (snapshot.status === 'deleted' ? 2 : 1)
    ) {
      throw new DocumentError('invalid-state', 'Invalid document version.');
    }
    if (snapshot.status === 'deleted') {
      validateDate(snapshot.deletedAt);
      return new Document({
        ...identity,
        status: 'deleted',
        deletedAt: new Date(snapshot.deletedAt),
      });
    }

    validateDate(snapshot.createdAt);
    validateDate(snapshot.updatedAt);
    if (snapshot.updatedAt < snapshot.createdAt) {
      throw new DocumentError('invalid-state', 'Document update precedes creation.');
    }
    return new Document({
      ...identity,
      status: 'active',
      authorUserId: normalizeId(snapshot.authorUserId, 'author ID'),
      title: normalizeDocumentTitle(snapshot.title),
      body: validateDocumentBody(snapshot.body),
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  /** Applies the published version precondition and attributes only stored changes to the editor. */
  public patch(input: Patch): DocumentChange {
    const current = this.activeVersion(input.expectedVersion);
    if (input.title === undefined && input.body === undefined) {
      throw new DocumentError('empty-patch', 'A document patch must provide a title or body.');
    }
    const title = input.title === undefined ? current.title : normalizeDocumentTitle(input.title);
    const body = input.body === undefined ? current.body : validateDocumentBody(input.body);
    if (current.title === title && current.body === body) {
      return { document: this, event: null };
    }

    const actor = normalizeId(input.actorUserId, 'editor ID');
    const version = this.nextVersion(current, input.at);
    const document = new Document({
      ...current,
      title,
      body,
      authorUserId: actor,
      updatedAt: new Date(input.at),
      version,
    });
    return document.change('updated', actor, input.at);
  }

  /** Retains the identity and advanced version required by the published deletion fact. */
  public remove(input: Write): DocumentChange<DocumentFact> {
    const current = this.activeVersion(input.expectedVersion);
    const actor = normalizeId(input.actorUserId, 'deleting actor ID');
    const version = this.nextVersion(current, input.at);
    const document = new Document({
      status: 'deleted',
      id: current.id,
      organizationId: current.organizationId,
      spaceId: current.spaceId,
      version,
      deletedAt: new Date(input.at),
    });
    return document.change('deleted', actor, input.at);
  }

  private activeVersion(expectedVersion: number): ActiveSnapshot {
    if (this.state.status === 'deleted') {
      throw new DocumentError('not-found', 'Document has been deleted.');
    }
    if (this.state.version !== expectedVersion) {
      throw new DocumentError(
        'version-mismatch',
        'Document version has changed.',
        this.state.version,
      );
    }
    return this.state;
  }

  private nextVersion(current: ActiveSnapshot, at: Date): number {
    validateDate(at);
    if (at < current.updatedAt || current.version === Number.MAX_SAFE_INTEGER) {
      throw new DocumentError('invalid-state', 'Document version or timestamp cannot advance.');
    }
    return current.version + 1;
  }

  private change(
    kind: DocumentFact['kind'],
    actorUserId: string,
    at: Date,
  ): DocumentChange<DocumentFact> {
    return {
      document: this,
      event: {
        kind,
        documentId: this.state.id,
        organizationId: this.state.organizationId,
        spaceId: this.state.spaceId,
        actorUserId,
        version: this.state.version,
        occurredAt: new Date(at),
      },
    };
  }
  // #endregion
}

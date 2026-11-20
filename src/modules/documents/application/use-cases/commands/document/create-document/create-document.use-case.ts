import { Document } from '../../../../../domain/aggregates/document/document.aggregate.js';
import {
  normalizeDocumentTitle,
  validateDocumentBody,
} from '../../../../../domain/policies/document/document-content.policy.js';
import { DocumentApplicationError } from '../../../../models/document/document-application-error.model.js';
import type { DocumentSpaceAccess } from '../../../../ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentRuntime } from '../../../../ports/outbound/runtime/document/document-runtime.port.js';
import type { DocumentUnitOfWork } from '../../../../ports/outbound/transactions/document/document-unit-of-work.port.js';
import { documentRoles } from '../../../../services/document/document-authorization.service.js';
import type { CreateDocumentInput } from './create-document.input.js';
import type { CreateDocumentOutput } from './create-document.output.js';

/** Creates a document and its durable fact under a current Task authorization proof. */
export class CreateDocument {
  // #region Constructor
  /** Binds the current authority, clock and tenant transaction. */
  public constructor(
    private readonly access: DocumentSpaceAccess,
    private readonly work: DocumentUnitOfWork,
    private readonly runtime: DocumentRuntime,
  ) {}
  // #endregion

  // #region Methods
  /** Reserves a replay key and commits the document, receipt and fact atomically. */
  public async execute(input: CreateDocumentInput): Promise<CreateDocumentOutput> {
    const role = (await documentRoles(this.access, input, [input.spaceId])).get(
      input.spaceId.toLowerCase(),
    );
    if (role === undefined) throw new DocumentApplicationError('space-not-found');
    if (role !== 'edit') throw new DocumentApplicationError('role-insufficient', role);
    const title = normalizeDocumentTitle(input.title);
    const body = validateDocumentBody(input.body ?? '');
    const bytes = new TextEncoder().encode(
      JSON.stringify([input.spaceId.toLowerCase(), title, body]),
    );
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const fingerprint = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
    return this.work.run(input.organizationId, async (store) => {
      if (input.idempotencyKey !== undefined) {
        const receipt = await store.findCreateReceipt(input.actorUserId, input.idempotencyKey);
        if (receipt === 'in-progress')
          throw new DocumentApplicationError('idempotency-request-in-progress');
        if (receipt !== null) {
          if (receipt.fingerprint !== fingerprint)
            throw new DocumentApplicationError('idempotency-key-reused');
          const current = await store.find(receipt.documentId, true);
          if (current?.snapshot.status !== 'active' || receipt.document === null)
            throw new DocumentApplicationError('document-not-found');
          return { document: receipt.document };
        }
      }
      const change = Document.create({
        id: await store.newId(),
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        authorUserId: input.actorUserId,
        title,
        body,
        at: this.runtime.now(),
      });
      await store.insert(change.document);
      await store.append(change.event);
      if (input.idempotencyKey !== undefined) {
        await store.saveCreateReceipt(input.actorUserId, input.idempotencyKey, {
          fingerprint,
          documentId: change.document.snapshot.id,
          document: change.document.snapshot,
        });
      }
      return { document: change.document.snapshot };
    });
  }
  // #endregion
}

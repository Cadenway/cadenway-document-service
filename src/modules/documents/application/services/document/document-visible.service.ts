import type { Document } from '../../../domain/aggregates/document/document.aggregate.js';
import { DocumentApplicationError } from '../../models/document/document-application-error.model.js';
import type { DocumentCaller } from '../../models/document/document-caller.model.js';
import type { DocumentSpaceAccess } from '../../ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentReader } from '../../ports/outbound/persistence/document/document-reader.port.js';
import type { DocumentTransaction } from '../../models/document/document-transaction.model.js';
import type { DocumentUnitOfWork } from '../../ports/outbound/transactions/document/document-unit-of-work.port.js';
import { documentRoles } from './document-authorization.service.js';

const revisionChanged = Symbol('document-revision-changed');
const maximumWriteAuthorizationAgeMs = 2_000;

/** Rejects a write decision that aged while obtaining the local connection or row. */
export function requireFreshDocumentWrite(authorizedAt: number): void {
  if (performance.now() - authorizedAt > maximumWriteAuthorizationAgeMs) {
    throw new DocumentApplicationError('unavailable');
  }
}

/** Resolves a document without exposing whether an inaccessible one exists. */
export async function visibleDocument(
  reader: DocumentReader,
  access: DocumentSpaceAccess,
  caller: DocumentCaller,
  documentId: string,
  write: boolean,
): Promise<Document> {
  const document = await reader.find(caller.organizationId, documentId);
  if (document?.snapshot.status !== 'active') {
    await documentRoles(access, caller, []);
    throw new DocumentApplicationError('document-not-found');
  }
  const role = (await documentRoles(access, caller, [document.snapshot.spaceId])).get(
    document.snapshot.spaceId.toLowerCase(),
  );
  if (role === undefined) throw new DocumentApplicationError('document-not-found');
  if (write && role !== 'edit') throw new DocumentApplicationError('role-insufficient', role);
  return document;
}

/** Runs a mutation only on the revision observed before its live authorization decision. */
export async function withAuthorizedDocumentWrite<T>(
  reader: DocumentReader,
  access: DocumentSpaceAccess,
  work: DocumentUnitOfWork,
  input: DocumentCaller & { readonly documentId: string },
  mutate: (store: DocumentTransaction, document: Document) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authorized = await visibleDocument(reader, access, input, input.documentId, true);
    const authorizedAt = performance.now();
    const result = await work.run(input.organizationId, async (store) => {
      const document = await store.findAndLock(input.documentId);
      requireFreshDocumentWrite(authorizedAt);
      if (
        document?.snapshot.status !== 'active' ||
        document.snapshot.spaceId !== authorized.snapshot.spaceId
      ) {
        throw new DocumentApplicationError('document-not-found');
      }
      if (document.snapshot.version !== authorized.snapshot.version) return revisionChanged;
      return await mutate(store, document);
    });
    if (result !== revisionChanged) return result;
  }
  throw new DocumentApplicationError('unavailable');
}

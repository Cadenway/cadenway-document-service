import type { Document } from '../../../domain/aggregates/document/document.aggregate.js';
import { DocumentApplicationError } from '../../models/document/document-application-error.model.js';
import type { DocumentCaller } from '../../models/document/document-caller.model.js';
import type { DocumentSpaceAccess } from '../../ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentReader } from '../../ports/outbound/persistence/document/document-reader.port.js';
import { documentRoles } from './document-authorization.service.js';

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

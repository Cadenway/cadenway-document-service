import { remainingBudgetMs } from '@cadenway/nest-common';
import type { Provider } from '@nestjs/common';

import type { DocumentSpaceAccess } from '../../../../application/ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentCursor } from '../../../../application/ports/outbound/pagination/document/document-cursor.port.js';
import type { DocumentReader } from '../../../../application/ports/outbound/persistence/document/document-reader.port.js';
import type { DocumentRuntime } from '../../../../application/ports/outbound/runtime/document/document-runtime.port.js';
import type { DocumentUnitOfWork } from '../../../../application/ports/outbound/transactions/document/document-unit-of-work.port.js';
import { CreateDocument } from '../../../../application/use-cases/commands/document/create-document/create-document.use-case.js';
import { DeleteDocument } from '../../../../application/use-cases/commands/document/delete-document/delete-document.use-case.js';
import { UpdateDocument } from '../../../../application/use-cases/commands/document/update-document/update-document.use-case.js';
import { GetDocument } from '../../../../application/use-cases/queries/document/get-document/get-document.use-case.js';
import { ListDocuments } from '../../../../application/use-cases/queries/document/list-documents/list-documents.use-case.js';
import { AesDocumentCursorAdapter } from '../../../../infrastructure/adapters/crypto/aes-document-cursor.adapter.js';
import { DrizzleDocumentReader } from '../../../../infrastructure/persistence/drizzle/repositories/document/drizzle-document-reader.repository.js';
import { DrizzleDocumentUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/document/drizzle-document.unit-of-work.js';
import { DOCUMENT_SPACE_ACCESS } from '../../../tokens/document/document-space-access.token.js';

const clock: DocumentRuntime = { now: () => new Date() };

/** Binds document operations to the adapters without framework dependencies in application. */
export const documentUseCases: readonly Provider[] = [
  {
    provide: CreateDocument,
    inject: [DOCUMENT_SPACE_ACCESS, DrizzleDocumentUnitOfWork],
    useFactory: (access: DocumentSpaceAccess, work: DocumentUnitOfWork) =>
      new CreateDocument(access, work, clock),
  },
  {
    provide: UpdateDocument,
    inject: [DrizzleDocumentReader, DOCUMENT_SPACE_ACCESS, DrizzleDocumentUnitOfWork],
    useFactory: (reader: DocumentReader, access: DocumentSpaceAccess, work: DocumentUnitOfWork) =>
      new UpdateDocument(reader, access, work, clock),
  },
  {
    provide: DeleteDocument,
    inject: [DrizzleDocumentReader, DOCUMENT_SPACE_ACCESS, DrizzleDocumentUnitOfWork],
    useFactory: (reader: DocumentReader, access: DocumentSpaceAccess, work: DocumentUnitOfWork) =>
      new DeleteDocument(reader, access, work, clock),
  },
  {
    provide: GetDocument,
    inject: [DrizzleDocumentReader, DOCUMENT_SPACE_ACCESS],
    useFactory: (reader: DocumentReader, access: DocumentSpaceAccess) =>
      new GetDocument(reader, access),
  },
  {
    provide: ListDocuments,
    inject: [DrizzleDocumentReader, DOCUMENT_SPACE_ACCESS, AesDocumentCursorAdapter],
    useFactory: (reader: DocumentReader, access: DocumentSpaceAccess, cursors: DocumentCursor) =>
      new ListDocuments(reader, access, cursors, () => (remainingBudgetMs() ?? 0) > 0),
  },
];

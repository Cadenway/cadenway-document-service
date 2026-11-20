import { DocumentApplicationError } from '../../../../models/document/document-application-error.model.js';
import type { DocumentSpaceAccess } from '../../../../ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentReader } from '../../../../ports/outbound/persistence/document/document-reader.port.js';
import type { DocumentRuntime } from '../../../../ports/outbound/runtime/document/document-runtime.port.js';
import type { DocumentUnitOfWork } from '../../../../ports/outbound/transactions/document/document-unit-of-work.port.js';
import { visibleDocument } from '../../../../services/document/document-visible.service.js';
import type { DeleteDocumentInput } from './delete-document.input.js';
import type { DeleteDocumentOutput } from './delete-document.output.js';

/** Deletes a document and records its terminal version atomically. */
export class DeleteDocument {
  // #region Constructor
  /** Binds reads, current authority, transaction and clock. */
  public constructor(
    private readonly reader: DocumentReader,
    private readonly access: DocumentSpaceAccess,
    private readonly work: DocumentUnitOfWork,
    private readonly runtime: DocumentRuntime,
  ) {}
  // #endregion

  // #region Methods
  /** Rechecks the locked document after the external access decision. */
  public async execute(input: DeleteDocumentInput): Promise<DeleteDocumentOutput> {
    const authorized = await visibleDocument(
      this.reader,
      this.access,
      input,
      input.documentId,
      true,
    );
    const authorizedSpace = authorized.snapshot.spaceId;
    await this.work.run(input.organizationId, async (store) => {
      const document = await store.find(input.documentId, true);
      if (document?.snapshot.status !== 'active' || document.snapshot.spaceId !== authorizedSpace)
        throw new DocumentApplicationError('document-not-found');
      const change = document.remove({ ...input, at: this.runtime.now() });
      await store.save(change.document);
      await store.scrubCreateReceipts(input.documentId);
      await store.append(change.event);
    });
    return undefined;
  }
  // #endregion
}

import { DocumentApplicationError } from '../../../../models/document/document-application-error.model.js';
import type { DocumentSpaceAccess } from '../../../../ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentReader } from '../../../../ports/outbound/persistence/document/document-reader.port.js';
import type { DocumentRuntime } from '../../../../ports/outbound/runtime/document/document-runtime.port.js';
import type { DocumentUnitOfWork } from '../../../../ports/outbound/transactions/document/document-unit-of-work.port.js';
import { visibleDocument } from '../../../../services/document/document-visible.service.js';
import type { UpdateDocumentInput } from './update-document.input.js';
import type { UpdateDocumentOutput } from './update-document.output.js';

/** Applies a conditional edit within one tenant transaction. */
export class UpdateDocument {
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
  /** Saves a real change and its fact, leaving equivalent patches untouched. */
  public async execute(input: UpdateDocumentInput): Promise<UpdateDocumentOutput> {
    const authorized = await visibleDocument(
      this.reader,
      this.access,
      input,
      input.documentId,
      true,
    );
    const authorizedSpace = authorized.snapshot.spaceId;
    return this.work.run(input.organizationId, async (store) => {
      const document = await store.find(input.documentId, true);
      if (document?.snapshot.status !== 'active' || document.snapshot.spaceId !== authorizedSpace)
        throw new DocumentApplicationError('document-not-found');
      const change = document.patch({ ...input, at: this.runtime.now() });
      if (change.event !== null) {
        await store.save(change.document);
        await store.append(change.event);
      }
      return { document: change.document.snapshot };
    });
  }
  // #endregion
}

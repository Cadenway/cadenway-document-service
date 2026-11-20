import type { DocumentSpaceAccess } from '../../../../ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentReader } from '../../../../ports/outbound/persistence/document/document-reader.port.js';
import { visibleDocument } from '../../../../services/document/document-visible.service.js';
import type { GetDocumentInput } from './get-document.input.js';
import type { GetDocumentOutput } from './get-document.output.js';

/** Reads one document after a current space decision. */
export class GetDocument {
  // #region Constructor
  /** Binds tenant reads and live Task authority. */
  public constructor(
    private readonly reader: DocumentReader,
    private readonly access: DocumentSpaceAccess,
  ) {}
  // #endregion

  // #region Methods
  /** Returns only a readable current document. */
  public async execute(input: GetDocumentInput): Promise<GetDocumentOutput> {
    return {
      document: (await visibleDocument(this.reader, this.access, input, input.documentId, false))
        .snapshot,
    };
  }
  // #endregion
}

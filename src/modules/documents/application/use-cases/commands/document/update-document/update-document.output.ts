import type { DocumentSnapshot } from '../../../../../domain/value-objects/document/document-snapshot.value-object.js';
/** Current document after an edit or equivalent replay. */
export interface UpdateDocumentOutput {
  // #region Properties
  /** Contract member. */
  readonly document: DocumentSnapshot;
  // #endregion
}

import type { DocumentSnapshot } from '../../../../../domain/value-objects/document/document-snapshot.value-object.js';
/** The authorized current document. */
export interface GetDocumentOutput {
  // #region Properties
  /** Contract member. */
  readonly document: DocumentSnapshot;
  // #endregion
}

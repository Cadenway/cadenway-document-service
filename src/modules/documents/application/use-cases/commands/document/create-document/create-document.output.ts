import type { DocumentSnapshot } from '../../../../../domain/value-objects/document/document-snapshot.value-object.js';
/** The original creation result, including on replay. */
export interface CreateDocumentOutput {
  // #region Properties
  /** Contract member. */
  readonly document: DocumentSnapshot;
  // #endregion
}

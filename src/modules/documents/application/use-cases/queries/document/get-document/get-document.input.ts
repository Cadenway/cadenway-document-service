import type { DocumentCaller } from '../../../../models/document/document-caller.model.js';
/** The verified caller and requested identifier. */
export interface GetDocumentInput extends DocumentCaller {
  // #region Properties
  /** Contract member. */
  readonly documentId: string;
  // #endregion
}

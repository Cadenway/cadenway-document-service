import type { DocumentCaller } from '../../../../models/document/document-caller.model.js';
/** An authorized conditional deletion. */
export interface DeleteDocumentInput extends DocumentCaller {
  // #region Properties
  /** Contract member. */
  readonly documentId: string;
  readonly expectedVersion: number;
  // #endregion
}

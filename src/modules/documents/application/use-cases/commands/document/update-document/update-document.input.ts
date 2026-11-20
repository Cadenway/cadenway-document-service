import type { DocumentCaller } from '../../../../models/document/document-caller.model.js';
/** An authorized conditional document edit. */
export interface UpdateDocumentInput extends DocumentCaller {
  // #region Properties
  /** Contract member. */
  readonly documentId: string;
  readonly title?: string;
  readonly body?: string;
  readonly expectedVersion: number;
  // #endregion
}

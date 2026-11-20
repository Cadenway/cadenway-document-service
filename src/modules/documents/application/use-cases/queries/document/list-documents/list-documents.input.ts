import type { DocumentCaller } from '../../../../models/document/document-caller.model.js';
/** One caller-scoped catalog page. */
export interface ListDocumentsInput extends DocumentCaller {
  // #region Properties
  /** Contract member. */
  readonly query?: string;
  readonly cursor?: string;
  readonly limit: number;
  // #endregion
}

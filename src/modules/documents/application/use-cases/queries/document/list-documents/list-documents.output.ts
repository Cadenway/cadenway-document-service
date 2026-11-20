import type { DocumentSummary } from '../../../../models/document/document-summary.model.js';
/** Readable metadata candidates and the next opaque cursor. */
export interface ListDocumentsOutput {
  // #region Properties
  /** Contract member. */
  readonly items: readonly DocumentSummary[];
  readonly nextCursor: string | null;
  // #endregion
}

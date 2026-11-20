import type { DocumentSearchProjection } from '../../../../models/search-projection/document-search-projection.model.js';

/** A bounded export page. */
export interface ListDocumentSearchProjectionsOutput {
  // #region Properties
  /** Active documents in UUID order and the optional continuation. */
  readonly items: readonly DocumentSearchProjection[];
  readonly nextCursor: string | null;
  // #endregion
}

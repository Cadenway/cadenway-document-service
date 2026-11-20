import type { DocumentSearchProjectionResolution } from '../../../../models/search-projection/document-search-projection-resolution.model.js';

/** An ordered resolution batch. */
export interface ResolveDocumentSearchProjectionsOutput {
  // #region Properties
  /** Exactly one result per requested ID, in request order. */
  readonly results: readonly DocumentSearchProjectionResolution[];
  // #endregion
}

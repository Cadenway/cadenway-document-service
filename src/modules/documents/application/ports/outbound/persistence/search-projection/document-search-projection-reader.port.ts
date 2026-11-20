import type { DocumentSearchProjectionPosition } from '../../../../models/search-projection/document-search-projection-position.model.js';
import type { DocumentSearchProjectionResolution } from '../../../../models/search-projection/document-search-projection-resolution.model.js';
import type { DocumentSearchProjection } from '../../../../models/search-projection/document-search-projection.model.js';

/** Loads bounded projections in one read snapshot per operation. */
export interface DocumentSearchProjectionReader {
  // #region Methods
  /** Exports a prefix whose compact JSON fits with a null continuation. */
  list(
    organizationId: string,
    input: {
      readonly position?: DocumentSearchProjectionPosition;
      readonly limit: number;
      readonly maximumBytes: number;
    },
  ): Promise<{
    readonly items: readonly DocumentSearchProjection[];
    readonly upperBound: string | null;
    readonly hasMore: boolean;
  }>;

  /** Returns the complete batch, or null when that batch exceeds the compact JSON budget. */
  resolve(
    organizationId: string,
    documentIds: readonly string[],
    maximumBytes: number,
  ): Promise<{ readonly results: readonly DocumentSearchProjectionResolution[] } | null>;
  // #endregion
}

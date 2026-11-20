import type { DocumentSearchProjectionPosition } from '../../../../models/search-projection/document-search-projection-position.model.js';

/** Encodes an opaque continuation scoped to the verified organization. */
export interface DocumentSearchProjectionCursor {
  // #region Methods
  /** Seals the position against the selected organization. */
  encode(organizationId: string, position: DocumentSearchProjectionPosition): string;
  decode(organizationId: string, cursor: string): DocumentSearchProjectionPosition;
  // #endregion
}

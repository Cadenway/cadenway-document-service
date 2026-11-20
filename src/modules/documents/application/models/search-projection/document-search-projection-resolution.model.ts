import type { DocumentSearchProjection } from './document-search-projection.model.js';

/** A current projection, a versioned deletion fence, or an ID unknown to the tenant. */
export type DocumentSearchProjectionResolution =
  | { readonly status: 'present'; readonly projection: DocumentSearchProjection }
  | { readonly status: 'absent'; readonly documentId: string; readonly version: number | null };

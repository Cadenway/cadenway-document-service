import type { DocumentPosition } from '../../../../models/document/document-position.model.js';

export { DocumentApplicationError } from '../../../../models/document/document-application-error.model.js';

/** Authenticates opaque positions against the caller, organization and normalized query. */
export interface DocumentCursor {
  // #region Methods
  /** Contract member. */
  encode(input: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly query: string;
    readonly position: DocumentPosition;
  }): string;
  decode(input: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly query: string;
    readonly cursor: string;
  }): DocumentPosition;
  // #endregion
}

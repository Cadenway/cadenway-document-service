/** Resolves the caller's current direct-space roles from Task. */
export interface DocumentSpaceAccess {
  // #region Methods
  /** Contract member. */
  resolve(input: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly spaceIds: readonly string[];
  }): Promise<readonly { readonly spaceId: string; readonly role: 'view' | 'comment' | 'edit' }[]>;
  // #endregion
}
export { DocumentApplicationError } from '../../../../models/document/document-application-error.model.js';

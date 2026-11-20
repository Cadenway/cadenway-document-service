/** Verified actor and organization taken from the internal token. */
export interface DocumentCaller {
  // #region Properties
  /** Contract member. */
  readonly organizationId: string;
  readonly actorUserId: string;
  // #endregion
}

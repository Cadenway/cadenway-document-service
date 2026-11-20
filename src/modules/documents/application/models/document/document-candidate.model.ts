/** Content-free catalog position used before checking the current space role. */
export interface DocumentCandidate {
  // #region Properties
  /** Opaque document identity and its tenant, space and position. */
  readonly id: string;
  readonly organizationId: string;
  readonly spaceId: string;
  readonly updatedAt: Date;
  // #endregion
}

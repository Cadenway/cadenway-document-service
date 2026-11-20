/** Current-version lookups in the verified organization, in request order. */
export interface ResolveDocumentSearchProjectionsInput {
  // #region Properties
  /** Verified tenant and requested document IDs in original order. */
  readonly organizationId: string;
  readonly documentIds: readonly string[];
  // #endregion
}

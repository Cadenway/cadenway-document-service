/** A bounded export in the verified organization. */
export interface ListDocumentSearchProjectionsInput {
  // #region Properties
  /** Verified tenant and the requested page parameters. */
  readonly organizationId: string;
  readonly cursor?: string;
  readonly limit: number;
  // #endregion
}

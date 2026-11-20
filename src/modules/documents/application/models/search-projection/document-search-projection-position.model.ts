/** The exclusive position and inclusive fence of one organization export. */
export interface DocumentSearchProjectionPosition {
  // #region Properties
  /** The last UUID emitted by the previous page. */
  readonly lastId: string;
  readonly upperBound: string;
  // #endregion
}

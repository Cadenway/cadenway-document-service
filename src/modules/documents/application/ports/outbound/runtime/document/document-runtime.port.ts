/** Supplies service-generated identifiers and the current time. */
export interface DocumentRuntime {
  // #region Methods
  /** Contract member. */
  now(): Date;
  // #endregion
}

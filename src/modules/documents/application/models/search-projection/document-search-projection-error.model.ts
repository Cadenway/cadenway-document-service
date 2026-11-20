/** A failure that can be mapped to a Search producer contract response. */
export class DocumentSearchProjectionError extends Error {
  // #region Constructor
  /** Identifies the failure without retaining the cursor, source text or a dependency error. */
  public constructor(public readonly reason: 'invalid-cursor' | 'batch-too-large' | 'unavailable') {
    super(reason);
    this.name = 'DocumentSearchProjectionError';
  }
  // #endregion
}

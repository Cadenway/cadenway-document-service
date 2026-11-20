/** A stable application refusal that presentation maps to the published contract. */
export class DocumentApplicationError extends Error {
  // #region Constructor
  /** Carries no document content or other sensitive data. */
  public constructor(
    public readonly reason:
      | 'organization-not-found'
      | 'space-not-found'
      | 'document-not-found'
      | 'role-insufficient'
      | 'unavailable'
      | 'idempotency-key-reused'
      | 'idempotency-request-in-progress'
      | 'invalid-cursor',
    public readonly role?: 'view' | 'comment',
  ) {
    super(reason);
    this.name = 'DocumentApplicationError';
  }
  // #endregion
}

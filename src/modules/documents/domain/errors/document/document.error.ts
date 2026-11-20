import { DomainError } from './domain.error.js';

type DocumentErrorReason =
  | 'invalid-state'
  | 'invalid-title'
  | 'invalid-body'
  | 'empty-patch'
  | 'not-found'
  | 'version-mismatch';

/** Refusal of a document lifecycle rule. */
export class DocumentError extends DomainError {
  // #region Constructor
  /** Carries the current version when a write precondition fails. */
  public constructor(
    public readonly reason: DocumentErrorReason,
    message: string,
    public readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'DocumentError';
  }
  // #endregion
}

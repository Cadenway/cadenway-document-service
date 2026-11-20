import type { DocumentTransaction } from '../../../../models/document/document-transaction.model.js';

/** Runs all document mutations and outbox writes in one tenant transaction. */
export interface DocumentUnitOfWork {
  // #region Methods
  /** Contract member. */
  run<T>(organizationId: string, work: (store: DocumentTransaction) => Promise<T>): Promise<T>;
  // #endregion
}

import type { DocumentSnapshot } from '../../../domain/value-objects/document/document-snapshot.value-object.js';

/** Original result and normalized request fingerprint held for the replay window. */
export interface DocumentCreateReceipt {
  // #region Properties
  /** Contract member. */
  readonly fingerprint: string;
  readonly documentId: string;
  readonly document: DocumentSnapshot | null;
  // #endregion
}

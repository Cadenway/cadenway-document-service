import type { DocumentCandidate } from './document-candidate.model.js';

/** Metadata returned after live space authorization and literal search. */
export interface DocumentSummary extends DocumentCandidate {
  // #region Properties
  /** Authorized document metadata. */
  readonly title: string;
  readonly authorUserId: string;
  readonly createdAt: Date;
  readonly version: number;
  // #endregion
}

import type { Document } from '../../../../../domain/aggregates/document/document.aggregate.js';
import type { DocumentCandidate } from '../../../../models/document/document-candidate.model.js';
import type { DocumentPosition } from '../../../../models/document/document-position.model.js';
import type { DocumentSummary } from '../../../../models/document/document-summary.model.js';

/** Reads tenant-scoped candidates in stable order without disclosing them. */
export interface DocumentReader {
  // #region Methods
  /** Contract member. */
  find(organizationId: string, documentId: string): Promise<Document | null>;
  scan(
    organizationId: string,
    input: {
      readonly cursor: DocumentPosition | null;
      readonly limit: number;
    },
  ): Promise<{ readonly items: readonly DocumentCandidate[]; readonly hasMore: boolean }>;
  findMatchingSummaries(
    organizationId: string,
    input: { readonly candidates: readonly DocumentCandidate[]; readonly query: string },
  ): Promise<readonly DocumentSummary[]>;
  // #endregion
}

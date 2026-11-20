import { DocumentSearchProjectionError } from '../../../../models/search-projection/document-search-projection-error.model.js';
import type { DocumentSearchProjectionReader } from '../../../../ports/outbound/persistence/search-projection/document-search-projection-reader.port.js';
import {
  compactJsonBytes,
  documentSearchProjectionResponseBytes,
} from '../../../../services/search-projection/document-search-projection-bytes.service.js';
import type { ResolveDocumentSearchProjectionsInput } from './resolve-document-search-projections.input.js';
import type { ResolveDocumentSearchProjectionsOutput } from './resolve-document-search-projections.output.js';

/** Resolves a bounded set of IDs to current projections or tenant-scoped absences. */
export class ResolveDocumentSearchProjections {
  // #region Constructor
  /** Binds the tenant projection reader. */
  public constructor(private readonly reader: DocumentSearchProjectionReader) {}
  // #endregion

  // #region Methods
  /** Establishes every result in the batch before returning any result. */
  public async execute(
    input: ResolveDocumentSearchProjectionsInput,
  ): Promise<ResolveDocumentSearchProjectionsOutput> {
    const documentIds = input.documentIds.map((id) => id.toLowerCase());
    const batch = await this.reader.resolve(
      input.organizationId,
      documentIds,
      documentSearchProjectionResponseBytes,
    );
    if (batch === null) throw new DocumentSearchProjectionError('batch-too-large');
    if (
      batch.results.length !== documentIds.length ||
      batch.results.some(
        (result, index) =>
          (result.status === 'present' ? result.projection.documentId : result.documentId) !==
          documentIds[index],
      )
    ) {
      throw new DocumentSearchProjectionError('unavailable');
    }
    if (compactJsonBytes(batch) > documentSearchProjectionResponseBytes) {
      throw new DocumentSearchProjectionError('batch-too-large');
    }
    return batch;
  }
  // #endregion
}

import { DocumentSearchProjectionError } from '../../../../models/search-projection/document-search-projection-error.model.js';
import type { DocumentSearchProjectionCursor } from '../../../../ports/outbound/pagination/search-projection/document-search-projection-cursor.port.js';
import type { DocumentSearchProjectionReader } from '../../../../ports/outbound/persistence/search-projection/document-search-projection-reader.port.js';
import {
  compactJsonBytes,
  documentSearchProjectionResponseBytes,
} from '../../../../services/search-projection/document-search-projection-bytes.service.js';
import type { ListDocumentSearchProjectionsInput } from './list-document-search-projections.input.js';
import type { ListDocumentSearchProjectionsOutput } from './list-document-search-projections.output.js';

/** Exports active rows and establishes a bounded continuation from the last emitted row. */
export class ListDocumentSearchProjections {
  // #region Constructor
  /** Binds the tenant reader and the configured, replica-stable cursor codec. */
  public constructor(
    private readonly reader: DocumentSearchProjectionReader,
    private readonly cursors: DocumentSearchProjectionCursor | null,
  ) {}
  // #endregion

  // #region Methods
  /** Returns a compact page with a continuation only when an eligible row remains. */
  public async execute(
    input: ListDocumentSearchProjectionsInput,
  ): Promise<ListDocumentSearchProjectionsOutput> {
    const cursors = this.cursors;
    if (cursors === null) throw new DocumentSearchProjectionError('unavailable');
    const position = this.decode(input, cursors);
    const scan = await this.reader.list(input.organizationId, {
      position,
      limit: input.limit,
      maximumBytes: documentSearchProjectionResponseBytes,
    });
    const items = [...scan.items];
    let hasMore = scan.hasMore;
    do {
      const last = items.at(-1);
      let nextCursor: string | null = null;
      if (hasMore) {
        if (last === undefined || scan.upperBound === null) {
          throw new DocumentSearchProjectionError('unavailable');
        }
        nextCursor = cursors.encode(input.organizationId, {
          lastId: last.documentId,
          upperBound: scan.upperBound,
        });
      }
      const page = { items, nextCursor };
      if (compactJsonBytes(page) <= documentSearchProjectionResponseBytes) return page;
      items.pop();
      hasMore = true;
    } while (items.length > 0);

    throw new DocumentSearchProjectionError('unavailable');
  }

  private decode(
    input: ListDocumentSearchProjectionsInput,
    cursors: DocumentSearchProjectionCursor,
  ) {
    if (input.cursor === undefined) return undefined;
    try {
      return cursors.decode(input.organizationId, input.cursor);
    } catch {
      throw new DocumentSearchProjectionError('invalid-cursor');
    }
  }
  // #endregion
}

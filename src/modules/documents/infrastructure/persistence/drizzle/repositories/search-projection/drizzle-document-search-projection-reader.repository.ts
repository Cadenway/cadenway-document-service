import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import type { DocumentSearchProjectionPosition } from '../../../../../application/models/search-projection/document-search-projection-position.model.js';
import type { DocumentSearchProjectionResolution } from '../../../../../application/models/search-projection/document-search-projection-resolution.model.js';
import type { DocumentSearchProjection } from '../../../../../application/models/search-projection/document-search-projection.model.js';
import type { DocumentSearchProjectionReader } from '../../../../../application/ports/outbound/persistence/search-projection/document-search-projection-reader.port.js';
import { documents } from '../../schemas/document/documents.schema.js';

type ProjectionMeasurement = Pick<
  DocumentSearchProjection,
  'documentId' | 'spaceId' | 'version'
> & {
  readonly status: string;
  readonly contentBytes: number | null;
};

const projectionColumns = {
  documentId: documents.id,
  spaceId: documents.spaceId,
  version: documents.version,
};

const measurementColumns = {
  ...projectionColumns,
  status: documents.status,
  // Measure both JSON-escaped strings in PostgreSQL. Their four quotes are in the empty projection.
  contentBytes: sql<number | null>`case when ${documents.status} = 'active' then
    octet_length(to_json(${documents.title})::text) + octet_length(to_json(${documents.body})::text) - 4
    else 0 end`,
};

const readSnapshot = { readOnly: true, isolationLevel: 'repeatable read' } as const;

/** Loads only the bodies that fit in the configured response budget, under one tenant snapshot. */
export class DrizzleDocumentSearchProjectionReader implements DocumentSearchProjectionReader {
  // #region Constructor
  /** Binds reads to the verified organization's tenant runner. */
  public constructor(private readonly tenant: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Exports a prefix ascending by document ID and detects any remaining eligible rows. */
  public async list(
    organizationId: string,
    input: {
      readonly position?: DocumentSearchProjectionPosition;
      readonly limit: number;
      readonly maximumBytes: number;
    },
  ): ReturnType<DocumentSearchProjectionReader['list']> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new RangeError('Document projection page limit is invalid.');
    }
    return this.tenant.run(async (scope) => {
      this.requireOrganization(scope, organizationId);
      const upperBound =
        input.position?.upperBound ?? (await this.findUpperBound(scope, organizationId));
      if (upperBound === null) return { items: [], upperBound, hasMore: false };

      const rows = await scope.db
        .select(measurementColumns)
        .from(documents)
        .where(
          and(
            eq(documents.organizationId, organizationId),
            eq(documents.status, 'active'),
            lte(documents.id, upperBound),
            input.position === undefined ? undefined : gt(documents.id, input.position.lastId),
          ),
        )
        .orderBy(asc(documents.id))
        .limit(input.limit + 1);

      let size = JSON.stringify({ items: [], nextCursor: null }).length;
      const selectedIds: string[] = [];
      for (const row of rows.slice(0, input.limit)) {
        size += JSON.stringify(this.emptyProjection(row)).length + this.contentBytes(row);
        if (selectedIds.length > 0) size += 1;
        if (size > input.maximumBytes) break;
        selectedIds.push(row.documentId);
      }
      if (rows.length > 0 && selectedIds.length === 0) {
        throw new Error('A document projection exceeds the page budget.');
      }

      const projections = await this.readProjections(scope, organizationId, selectedIds);
      return {
        items: selectedIds.map((documentId) => this.requireProjection(projections, documentId)),
        upperBound,
        hasMore: rows.length > selectedIds.length,
      };
    }, readSnapshot);
  }

  /** Resolves the entire batch, including versioned deletion fences, in caller order. */
  public async resolve(
    organizationId: string,
    documentIds: readonly string[],
    maximumBytes: number,
  ): ReturnType<DocumentSearchProjectionReader['resolve']> {
    if (
      documentIds.length < 1 ||
      documentIds.length > 100 ||
      new Set(documentIds).size !== documentIds.length
    ) {
      throw new RangeError('Document projection resolution batch is invalid.');
    }
    return this.tenant.run(async (scope) => {
      this.requireOrganization(scope, organizationId);
      const rows = await scope.db
        .select(measurementColumns)
        .from(documents)
        .where(
          and(eq(documents.organizationId, organizationId), inArray(documents.id, documentIds)),
        );
      const byId = new Map(rows.map((row) => [row.documentId, row]));
      let size = JSON.stringify({ results: [] }).length;
      const activeIds: string[] = [];
      const results: DocumentSearchProjectionResolution[] = [];

      for (const documentId of documentIds) {
        const row = byId.get(documentId);
        const result = this.measureResolution(documentId, row);
        size += JSON.stringify(result).length;
        if (results.length > 0) size += 1;
        if (result.status === 'present' && row !== undefined) {
          size += this.contentBytes(row);
          activeIds.push(documentId);
        }
        if (size > maximumBytes) return null;
        results.push(result);
      }

      const projections = await this.readProjections(scope, organizationId, activeIds);
      return {
        results: results.map((result) =>
          result.status === 'absent'
            ? result
            : {
                status: 'present',
                projection: this.requireProjection(projections, result.projection.documentId),
              },
        ),
      };
    }, readSnapshot);
  }

  private requireOrganization(scope: TransactionScope, organizationId: string): void {
    if (scope.organizationId?.toLowerCase() !== organizationId.toLowerCase()) {
      throw new Error('Document projection tenant mismatch.');
    }
  }

  private async findUpperBound(
    scope: TransactionScope,
    organizationId: string,
  ): Promise<string | null> {
    const [row] = await scope.db
      .select({ documentId: documents.id })
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.status, 'active')))
      .orderBy(desc(documents.id))
      .limit(1);
    return row?.documentId ?? null;
  }

  private emptyProjection(row: ProjectionMeasurement): DocumentSearchProjection {
    return {
      documentId: row.documentId,
      spaceId: row.spaceId,
      version: row.version,
      title: '',
      body: '',
    };
  }

  private contentBytes(row: ProjectionMeasurement): number {
    if (row.contentBytes === null)
      throw new Error('Active document projection has incomplete content.');
    return row.contentBytes;
  }

  private measureResolution(
    documentId: string,
    row: ProjectionMeasurement | undefined,
  ): DocumentSearchProjectionResolution {
    if (row?.status === 'active')
      return { status: 'present', projection: this.emptyProjection(row) };
    if (row === undefined || row.status === 'deleted') {
      return { status: 'absent', documentId, version: row?.version ?? null };
    }
    throw new Error('Document projection state is invalid.');
  }

  private async readProjections(
    scope: TransactionScope,
    organizationId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, DocumentSearchProjection>> {
    const projections = new Map<string, DocumentSearchProjection>();
    if (documentIds.length === 0) return projections;
    const rows = await scope.db
      .select({ ...projectionColumns, title: documents.title, body: documents.body })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.status, 'active'),
          inArray(documents.id, documentIds),
        ),
      );
    for (const row of rows) {
      if (row.title === null || row.body === null) {
        throw new Error('Active document projection has incomplete content.');
      }
      projections.set(row.documentId, { ...row, title: row.title, body: row.body });
    }
    return projections;
  }

  private requireProjection(
    projections: ReadonlyMap<string, DocumentSearchProjection>,
    documentId: string,
  ): DocumentSearchProjection {
    const projection = projections.get(documentId);
    if (projection === undefined) throw new Error('A selected document projection is missing.');
    return projection;
  }
  // #endregion
}

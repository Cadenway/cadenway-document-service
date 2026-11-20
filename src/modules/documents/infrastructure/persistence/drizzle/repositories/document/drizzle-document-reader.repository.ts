import type { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { and, eq, lt, or, sql } from 'drizzle-orm';

import type { DocumentPosition } from '../../../../../application/models/document/document-position.model.js';
import type { DocumentCandidate } from '../../../../../application/models/document/document-candidate.model.js';
import type { DocumentSummary } from '../../../../../application/models/document/document-summary.model.js';
import type { DocumentReader } from '../../../../../application/ports/outbound/persistence/document/document-reader.port.js';
import type { Document } from '../../../../../domain/aggregates/document/document.aggregate.js';
import { documentFromRow } from '../../mappers/document/document-row.mapper.js';
import { documents } from '../../schemas/document/documents.schema.js';

/** Reads bounded candidates from the selected tenant's current document catalog. */
export class DrizzleDocumentReader implements DocumentReader {
  // #region Constructor
  /** Binds reads to the caller's tenant runner. */
  public constructor(private readonly tenant: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Finds a single document in the selected organization. */
  public async find(organizationId: string, documentId: string): Promise<Document | null> {
    return this.tenant.run(
      async (scope) => {
        if (scope.organizationId?.toLowerCase() !== organizationId.toLowerCase()) {
          throw new Error('Document tenant mismatch.');
        }
        const [row] = await scope.db
          .select()
          .from(documents)
          .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
          .limit(1);
        return row === undefined ? null : documentFromRow(row);
      },
      { readOnly: true },
    );
  }

  /** Uses a descending keyset and one sentinel to bound each visibility batch. */
  public async scan(
    organizationId: string,
    input: {
      readonly cursor: DocumentPosition | null;
      readonly limit: number;
    },
  ): Promise<{ readonly items: readonly DocumentCandidate[]; readonly hasMore: boolean }> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new RangeError('Document page limit is invalid.');
    }
    return this.tenant.run(
      async (scope) => {
        if (scope.organizationId?.toLowerCase() !== organizationId.toLowerCase()) {
          throw new Error('Document tenant mismatch.');
        }
        const cursor = input.cursor;
        const position =
          cursor === null
            ? undefined
            : or(
                lt(documents.updatedAt, cursor.updatedAt),
                and(eq(documents.updatedAt, cursor.updatedAt), lt(documents.id, cursor.id)),
              );
        const rows = await scope.db
          .select({
            id: documents.id,
            organizationId: documents.organizationId,
            spaceId: documents.spaceId,
            updatedAt: documents.updatedAt,
          })
          .from(documents)
          .where(
            and(
              eq(documents.organizationId, organizationId),
              eq(documents.status, 'active'),
              position,
            ),
          )
          .orderBy(
            sql`${documents.updatedAt} desc nulls last`,
            sql`${documents.id} desc nulls last`,
          )
          .limit(input.limit + 1);
        return {
          items: rows.slice(0, input.limit).map((row) => {
            if (row.updatedAt === null) throw new Error('Active document has no update time.');
            return { ...row, updatedAt: row.updatedAt };
          }),
          hasMore: rows.length > input.limit,
        };
      },
      { readOnly: true },
    );
  }

  /** Tests the query only against the bounded set already authorized by Task. */
  public async findMatchingSummaries(
    organizationId: string,
    input: { readonly candidates: readonly DocumentCandidate[]; readonly query: string },
  ): Promise<readonly DocumentSummary[]> {
    if (input.candidates.length > 100)
      throw new RangeError('Document authorization batch is invalid.');
    if (input.candidates.length === 0) return [];
    return this.tenant.run(
      async (scope) => {
        if (scope.organizationId?.toLowerCase() !== organizationId.toLowerCase())
          throw new Error('Document tenant mismatch.');
        const positions = input.candidates.map((candidate) =>
          and(
            eq(documents.id, candidate.id),
            eq(documents.spaceId, candidate.spaceId),
            eq(documents.updatedAt, candidate.updatedAt),
          ),
        );
        const escaped = input.query.replace(/[\\%_]/gu, '\\$&');
        const search =
          input.query === ''
            ? undefined
            : sql`(${documents.title} ilike ${`%${escaped}%`} escape '\\' or ${documents.body} ilike ${`%${escaped}%`} escape '\\')`;
        const rows = await scope.db
          .select({
            id: documents.id,
            organizationId: documents.organizationId,
            spaceId: documents.spaceId,
            title: documents.title,
            authorUserId: documents.authorUserId,
            createdAt: documents.createdAt,
            updatedAt: documents.updatedAt,
            version: documents.version,
          })
          .from(documents)
          .where(
            and(
              eq(documents.organizationId, organizationId),
              eq(documents.status, 'active'),
              or(...positions),
              search,
            ),
          )
          .limit(100);
        return rows.map((row) => {
          if (
            row.title === null ||
            row.authorUserId === null ||
            row.createdAt === null ||
            row.updatedAt === null
          ) {
            throw new Error('Active document has incomplete metadata.');
          }
          return {
            ...row,
            title: row.title,
            authorUserId: row.authorUserId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        });
      },
      { readOnly: true },
    );
  }
  // #endregion
}

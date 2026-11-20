import { Document } from '../../../../../domain/aggregates/document/document.aggregate.js';
import type { documents } from '../../schemas/document/documents.schema.js';

type DocumentRow = typeof documents.$inferSelect;

/** Restores the validated aggregate represented by a tenant-filtered row. */
export function documentFromRow(row: DocumentRow): Document {
  const identity = {
    organizationId: row.organizationId,
    id: row.id,
    spaceId: row.spaceId,
    version: row.version,
  };
  if (row.status === 'deleted' && row.deletedAt !== null) {
    return Document.restore({ ...identity, status: 'deleted', deletedAt: row.deletedAt });
  }
  if (
    row.status === 'active' &&
    row.title !== null &&
    row.body !== null &&
    row.authorUserId !== null &&
    row.createdAt !== null &&
    row.updatedAt !== null
  ) {
    return Document.restore({
      ...identity,
      status: 'active',
      title: row.title,
      body: row.body,
      authorUserId: row.authorUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  throw new Error('Stored document has an invalid state.');
}

/** Maps a validated aggregate into its tenant-owned persistent representation. */
export function documentToRow(document: Document): typeof documents.$inferInsert {
  const state = document.snapshot;
  const identity = {
    organizationId: state.organizationId,
    id: state.id,
    spaceId: state.spaceId,
    version: state.version,
  };
  if (state.status === 'deleted') {
    return {
      ...identity,
      status: state.status,
      title: null,
      body: null,
      authorUserId: null,
      createdAt: null,
      updatedAt: null,
      deletedAt: state.deletedAt,
    };
  }
  return { ...identity, ...state, deletedAt: null };
}

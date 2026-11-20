import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  check,
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** A document and its permanent, versioned deletion fence. */
export const documents = pgTable(
  'documents',
  {
    organizationId: uuid('organization_id').notNull(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    spaceId: uuid('space_id').notNull(),
    version: bigint('version', { mode: 'number' }).notNull(),
    status: text('status').notNull(),
    title: text('title'),
    body: text('body'),
    authorUserId: uuid('author_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, precision: 3 }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index('documents_catalog_idx')
      .on(table.organizationId, table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'active'`),
    index('documents_space_idx')
      .on(table.organizationId, table.spaceId, table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'active'`),
    check('documents_version_check', sql`${table.version} between 1 and 9007199254740991`),
    check(
      'documents_state_check',
      sql`(${table.status} = 'active' and num_nonnulls(${table.title}, ${table.body}, ${table.authorUserId}, ${table.createdAt}, ${table.updatedAt}) = 5 and ${table.deletedAt} is null) or (${table.status} = 'deleted' and num_nonnulls(${table.title}, ${table.body}, ${table.authorUserId}, ${table.createdAt}, ${table.updatedAt}) = 0 and ${table.deletedAt} is not null)`,
    ),
    organizationPolicy('documents_organization_isolation'),
  ],
);

/** Original create response retained under the caller's idempotency key. */
export const documentCreateReceipts = pgTable(
  'document_create_receipts',
  {
    organizationId: uuid('organization_id').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    keyDigest: text('key_digest').notNull(),
    fingerprint: text('fingerprint').notNull(),
    documentId: uuid('document_id').notNull(),
    snapshot: jsonb('snapshot'),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.actorUserId, table.keyDigest] }),
    index('document_create_receipts_global_expiry_idx').on(
      table.expiresAt,
      table.organizationId,
      table.actorUserId,
      table.keyDigest,
    ),
    index('document_create_receipts_document_idx').on(table.organizationId, table.documentId),
    organizationPolicy('document_create_receipts_organization_isolation'),
  ],
);

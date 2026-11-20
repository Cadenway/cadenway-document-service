import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runWithOrganizationContext } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DrizzleExpiredDocumentReceipts } from '../src/modules/documents/infrastructure/persistence/drizzle/repositories/document/drizzle-document-receipt-cleanup.repository.js';
import { DrizzleDocumentReader } from '../src/modules/documents/infrastructure/persistence/drizzle/repositories/document/drizzle-document-reader.repository.js';
import { DrizzleDocumentTransaction } from '../src/modules/documents/infrastructure/persistence/drizzle/repositories/document/drizzle-document-transaction.repository.js';

const composeFile = fileURLToPath(new URL('../compose.dev.yaml', import.meta.url));
const project = `cadenway-document-receipts-${String(process.pid)}`;
const orgA = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';
const orgB = '01938f6e-0000-7000-8000-000000000002';
const actor = '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24';
const documentId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17';

/** Runs a command only in this test's disposable Compose project. */
function compose(...args: readonly string[]): string {
  return execFileSync(
    'docker',
    ['compose', '--project-name', project, '--file', composeFile, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, DEV_POSTGRES_PORT: '0', DEV_NATS_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

describe('expired document receipt maintenance', () => {
  let appPool: pg.Pool | undefined;
  let migrator: pg.Pool | undefined;
  let system: SystemTransactionRunner;
  let tenant: TenantTransactionRunner;

  beforeAll(async () => {
    compose('up', '--detach', '--wait', '--wait-timeout', '120', 'postgres');
    const port = compose('port', 'postgres', '5432').trim().split(':').at(-1);
    if (port === undefined || port === '') throw new Error('Fixture database port unavailable.');
    const migrateUrl = `postgres://document_migrator:document_migrator@127.0.0.1:${port}/document`;
    vi.stubEnv('MIGRATION_DATABASE_URL', migrateUrl);
    await import('../src/migrate.js');
    migrator = new pg.Pool({ connectionString: migrateUrl });
    appPool = new pg.Pool({
      connectionString: `postgres://document_app:document_app@127.0.0.1:${port}/document`,
      max: 4,
    });
    system = new SystemTransactionRunner(appPool);
    tenant = new TenantTransactionRunner(appPool);
  });

  afterAll(async () => {
    await appPool?.end();
    await migrator?.end();
    vi.unstubAllEnvs();
    compose('down', '--volumes', '--remove-orphans');
  });

  it('forces tenant isolation and removes only unlocked expired rows in bounded batches', async () => {
    if (migrator === undefined || appPool === undefined)
      throw new Error('Fixture database unavailable.');
    const policy = await migrator.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.document_create_receipts'::regclass",
    );
    expect(policy.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    await system.run(async (scope) => {
      await scope.db.execute(sql`
        insert into document_create_receipts (organization_id, actor_user_id, key_digest, fingerprint, document_id, snapshot, expires_at)
        values (${orgA}::uuid, ${actor}::uuid, 'expired-a', 'a', ${documentId}::uuid, '{"body":"a"}'::jsonb, statement_timestamp() - interval '2 hours'),
               (${orgB}::uuid, ${actor}::uuid, 'expired-b', 'b', ${documentId}::uuid, '{"body":"b"}'::jsonb, statement_timestamp() - interval '1 hour'),
               (${orgA}::uuid, ${actor}::uuid, 'live-a', 'c', ${documentId}::uuid, '{}'::jsonb, statement_timestamp() + interval '1 hour'),
               (${orgB}::uuid, ${actor}::uuid, 'live-b', 'd', ${documentId}::uuid, '{}'::jsonb, statement_timestamp() + interval '1 hour')
      `);
    });
    const visible = await runWithOrganizationContext(
      { organizationId: orgA, actor: { type: 'user', id: actor }, role: null, scopes: [] },
      () =>
        tenant.run(
          async (scope) =>
            scope.db.execute<{ key_digest: string }>(sql`
        select key_digest from document_create_receipts order by key_digest
      `),
          { readOnly: true },
        ),
    );
    expect(visible.rows.map((row) => row.key_digest)).toEqual(['expired-a', 'live-a']);

    const lock = await appPool.connect();
    try {
      await lock.query('begin');
      await lock.query("select set_config('app.organization_id', $1, true)", [orgA]);
      await lock.query(
        'select 1 from document_create_receipts where organization_id = $1 and key_digest = $2 for update',
        [orgA, 'expired-a'],
      );
      const cleanup = new DrizzleExpiredDocumentReceipts(system);
      await expect(cleanup.purgeExpired(1)).resolves.toBe(1);
      const remaining = await system.run(
        async (scope) =>
          scope.db.execute<{ key_digest: string }>(sql`
        select key_digest from document_create_receipts order by key_digest
      `),
        { readOnly: true },
      );
      expect(remaining.rows.map((row) => row.key_digest)).toEqual([
        'expired-a',
        'live-a',
        'live-b',
      ]);
      await lock.query('rollback');
      await expect(cleanup.purgeExpired(1)).resolves.toBe(1);
      await expect(cleanup.purgeExpired(1)).resolves.toBe(0);
      await expect(cleanup.purgeExpired(501)).rejects.toThrow(RangeError);
    } finally {
      await lock.query('rollback');
      lock.release();
    }
  });

  it('returns a contention result immediately for the same creation key', async () => {
    const outbox = {
      append: () => Promise.reject(new Error('Unexpected outbox append.')),
    };
    const context = {
      organizationId: orgA,
      actor: { type: 'user' as const, id: actor },
      role: null,
      scopes: [],
    };
    let unlock = (): void => undefined;
    let announce = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const first = runWithOrganizationContext(context, () =>
      tenant.run(async (scope) => {
        const store = new DrizzleDocumentTransaction(scope, orgA, outbox);
        expect(await store.findCreateReceipt(actor, 'simultaneous-creation')).toBeNull();
        announce();
        await held;
      }),
    );
    await locked;
    try {
      const second = await runWithOrganizationContext(context, () =>
        tenant.run(async (scope) => {
          const store = new DrizzleDocumentTransaction(scope, orgA, outbox);
          return store.findCreateReceipt(actor, 'simultaneous-creation');
        }),
      );
      expect(second).toBe('in-progress');
    } finally {
      unlock();
      await first;
    }
  });

  it('scans content-free candidates and filters literal text only inside the authorized set', async () => {
    const spaceA = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e01';
    const spaceB = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e02';
    const publicId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0021';
    const hiddenId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0022';
    await system.run(async (scope) => {
      await scope.db.execute(sql`
        insert into documents (organization_id, id, space_id, version, status, title, body, author_user_id, created_at, updated_at)
        values (${orgA}::uuid, ${publicId}::uuid, ${spaceA}::uuid, 1, 'active', 'Literal', ${'contains %_\\ here'}, ${actor}::uuid, statement_timestamp(), statement_timestamp()),
               (${orgA}::uuid, ${hiddenId}::uuid, ${spaceB}::uuid, 1, 'active', 'Hidden', 'private matching text', ${actor}::uuid, statement_timestamp(), statement_timestamp())
      `);
    });
    const reader = new DrizzleDocumentReader(tenant);
    const context = {
      organizationId: orgA,
      actor: { type: 'user' as const, id: actor },
      role: null,
      scopes: [],
    };
    const candidates = await runWithOrganizationContext(context, () =>
      reader.scan(orgA, { cursor: null, limit: 100 }),
    );
    expect(candidates.items).toHaveLength(2);
    expect(Object.keys(candidates.items[0] ?? {}).sort()).toEqual([
      'id',
      'organizationId',
      'spaceId',
      'updatedAt',
    ]);
    const allowed = candidates.items.filter((item) => item.id === publicId);
    const matches = await runWithOrganizationContext(context, () =>
      reader.findMatchingSummaries(orgA, { candidates: allowed, query: '%_\\' }),
    );
    expect(matches.map((item) => item.id)).toEqual([publicId]);
    const hidden = await runWithOrganizationContext(context, () =>
      reader.findMatchingSummaries(orgA, { candidates: allowed, query: 'private matching' }),
    );
    expect(hidden).toEqual([]);
  });
});

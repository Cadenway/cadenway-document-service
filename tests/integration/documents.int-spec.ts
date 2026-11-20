import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import type {
  DocumentSearchProjectionPage,
  DocumentSearchProjectionResults,
} from '@cadenway/contracts/types/internal/document-service';
import {
  createApplication,
  InternalTokenSigner,
  InternalTokenVerifier,
  loadConfig,
} from '@cadenway/nest-common';
import type { Ed25519PrivateJwk, Ed25519PublicJwk } from '@cadenway/nest-common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { appConfigSchema } from '../../src/config/app-config.js';
import { configureDocumentPrivateHttp } from '../../src/infrastructure/http/document-private-http.js';

const composeFile = fileURLToPath(new URL('../../compose.dev.yaml', import.meta.url));
const project = `cadenway-document-integration-${String(process.pid)}`;
const organizationId = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';
const otherOrganizationId = '01938f6e-0000-7000-8000-000000000002';
const userId = '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24';
const spaceId = '123e4567-e89b-42d3-a456-426614174000';
const hiddenSpaceId = '123e4567-e89b-42d3-a456-426614174001';
const projectionOrganizationId = '01938f6e-0000-7000-8000-00000000000a';
const projectionPath = '/internal/v1/document-search-projections';
const maximumProjectionBytes = 1_048_576;

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

function hostPort(service: string, port: string): string {
  return compose('port', service, port).trim().split(':').at(-1) ?? '';
}

function keys(kid: string): { publicJwk: Ed25519PublicJwk; privateJwk: Ed25519PrivateJwk } {
  const { x, d } = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  if (x === undefined || d === undefined) throw new Error('Synthetic key unavailable.');
  const publicJwk: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x, kid };
  return { publicJwk, privateJwk: { ...publicJwk, d } };
}

describe('documents through the signed internal HTTP boundary', () => {
  const gateway = keys('gateway-test');
  const documentSigner = keys('document-test');
  const search = keys('search-test');
  let app: NestExpressApplication | undefined;
  let signer: InternalTokenSigner;
  let searchSigner: InternalTokenSigner;
  let admin: pg.Pool | undefined;
  let task: Server | undefined;
  let taskVerifier: InternalTokenVerifier;
  let allowed = true;
  const role = 'edit';
  let failTask = false;
  let documentId = '';

  function service(): NestExpressApplication {
    if (app === undefined) throw new Error('Document fixture did not start.');
    return app;
  }

  function database(): pg.Pool {
    if (admin === undefined) throw new Error('Document fixture database did not start.');
    return admin;
  }

  async function makeApp(): Promise<NestExpressApplication> {
    const config = loadConfig(appConfigSchema);
    const created = await createApplication(AppModule, {
      service: 'document-service',
      config,
      internalToken: {
        verifier: {
          audience: config.INTERNAL_TOKEN_AUDIENCE,
          trustedIssuers: config.INTERNAL_TOKEN_TRUSTED_ISSUERS,
        },
        signer: { issuer: 'document-service', privateJwk: documentSigner.privateJwk },
      },
      logDestination: { write: (): void => undefined },
    });
    configureDocumentPrivateHttp(created);
    await created.init();
    return created;
  }

  async function bearer(organization: string): Promise<string> {
    return signer.sign('document-service', {
      actor: { type: 'user', id: userId },
      organizationId: organization,
    });
  }

  async function projectionBearer(organization: string): Promise<string> {
    return searchSigner.sign('document-service', {
      actor: { type: 'system', id: 'search-service' },
      organizationId: organization,
    });
  }

  async function insertProjectionSource(
    organization: string,
    projection: { documentId: string; version: number; title: string; body: string },
  ): Promise<void> {
    const client = await database().connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.organization_id', $1, true)", [organization]);
      await client.query(
        `insert into documents
          (organization_id, id, space_id, version, status, title, body, author_user_id, created_at, updated_at)
         values ($1, $2, $3, $4, 'active', $5, $6, $7, now(), now())`,
        [
          organization,
          projection.documentId,
          spaceId,
          projection.version,
          projection.title,
          projection.body,
          userId,
        ],
      );
      await client.query('commit');
    } finally {
      await client.query('rollback');
      client.release();
    }
  }

  beforeAll(async () => {
    compose(
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '120',
      'postgres',
      'nats',
      'nats-streams',
    );
    const postgresPort = hostPort('postgres', '5432');
    vi.stubEnv(
      'MIGRATION_DATABASE_URL',
      `postgres://document_migrator:document_migrator@127.0.0.1:${postgresPort}/document`,
    );
    await import('../../src/migrate.js');
    admin = new pg.Pool({
      connectionString: `postgres://document_migrator:document_migrator@127.0.0.1:${postgresPort}/document`,
    });
    taskVerifier = await InternalTokenVerifier.create({
      audience: 'task-service',
      trustedIssuers: { 'document-service': [documentSigner.publicJwk] },
    });
    const taskServer = createServer((incoming, response) => {
      void (async () => {
        const auth = incoming.headers.authorization ?? '';
        const principal = await taskVerifier.verify(auth.replace(/^Bearer /u, ''));
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Uint8Array));
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const spaceIds = (body as { spaceIds: string[] }).spaceIds;
        if (
          principal.actor.id !== userId ||
          incoming.url !== '/internal/v1/spaces/access/resolve' ||
          failTask
        ) {
          response.writeHead(503).end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        response.end(
          JSON.stringify({
            results: allowed
              ? spaceIds.filter((id) => id !== hiddenSpaceId).map((id) => ({ spaceId: id, role }))
              : [],
          }),
        );
      })().catch(() => {
        response.writeHead(401).end();
      });
    });
    task = taskServer;
    await new Promise<void>((resolve) => taskServer.listen(0, '127.0.0.1', resolve));
    const address = taskServer.address();
    if (address === null || typeof address === 'string')
      throw new Error('Fixture Task port unavailable.');
    vi.stubEnv('PORT', '3014');
    vi.stubEnv('LOG_PRETTY', 'false');
    vi.stubEnv(
      'DATABASE_URL',
      `postgres://document_app:document_app@127.0.0.1:${postgresPort}/document`,
    );
    vi.stubEnv('NATS_URL', `nats://127.0.0.1:${hostPort('nats', '4222')}`);
    vi.stubEnv('NATS_USER', 'document');
    vi.stubEnv('NATS_PASSWORD', 'document');
    vi.stubEnv('INTERNAL_TOKEN_AUDIENCE', 'document-service');
    vi.stubEnv(
      'INTERNAL_TOKEN_TRUSTED_ISSUERS',
      JSON.stringify({ 'api-gateway': [gateway.publicJwk], 'search-service': [search.publicJwk] }),
    );
    vi.stubEnv('INTERNAL_TOKEN_PRIVATE_JWK', JSON.stringify(documentSigner.privateJwk));
    vi.stubEnv('TASK_SERVICE_URL', `http://127.0.0.1:${String(address.port)}`);
    signer = await InternalTokenSigner.create({
      issuer: 'api-gateway',
      privateJwk: gateway.privateJwk,
    });
    searchSigner = await InternalTokenSigner.create({
      issuer: 'search-service',
      privateJwk: search.privateJwk,
    });
    app = await makeApp();
  });

  afterAll(async () => {
    try {
      await app?.close();
      await admin?.end();
      if (task !== undefined) {
        const taskServer = task;
        await new Promise<void>((resolve) => {
          taskServer.close(() => {
            resolve();
          });
        });
      }
    } finally {
      vi.unstubAllEnvs();
      compose('down', '--volumes', '--remove-orphans');
    }
  });

  it('persists a create receipt and verifies current authorization before its replay', async () => {
    const token = await bearer(organizationId);
    const body = { spaceId, title: 'Notes de version 3.1', body: '# Version\n' };
    const first = await request(service().getHttpServer())
      .post('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'fixture-create')
      .send(body);
    expect(first.status).toBe(201);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.headers.etag).toBe('"1"');
    documentId = (JSON.parse(first.text) as { id: string }).id;
    expect(first.headers.location).toBe(`/internal/v1/documents/${documentId}`);
    const replay = await request(service().getHttpServer())
      .post('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'fixture-create')
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    allowed = false;
    const hidden = await request(service().getHttpServer())
      .post('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'fixture-create')
      .send(body);
    expect(hidden.status).toBe(404);
    expect((JSON.parse(hidden.text) as { code: string }).code).toBe('space.not-found');
    allowed = true;
  });

  it('performs live access checks on conditional reads and isolates other tenants', async () => {
    const token = await bearer(organizationId);
    const other = await bearer(otherOrganizationId);
    const read = await request(service().getHttpServer())
      .get(`/internal/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', '*');
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(read.headers.etag).toBe('"1"');
    const invalidQuery = await request(service().getHttpServer())
      .get('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .query({ q: 'invalid\0query' });
    expect(invalidQuery.status).toBe(400);
    expect((JSON.parse(invalidQuery.text) as { code: string }).code).toBe('request.invalid');
    expect(
      (
        await request(service().getHttpServer())
          .get(`/internal/v1/documents/${documentId}`)
          .set('Authorization', `Bearer ${other}`)
      ).status,
    ).toBe(404);
    failTask = true;
    const unavailable = await request(service().getHttpServer())
      .get(`/internal/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(unavailable.status).toBe(503);
    expect((JSON.parse(unavailable.text) as { code: string }).code).toBe('document.unavailable');
    failTask = false;
  });

  it('persists across service restart and erases receipt content on deletion', async () => {
    const token = await bearer(organizationId);
    await service().close();
    app = await makeApp();
    const read = await request(service().getHttpServer())
      .get(`/internal/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect((JSON.parse(read.text) as { body: string }).body).toBe('# Version\n');
    const deleted = await request(service().getHttpServer())
      .delete(`/internal/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '"1"');
    expect(deleted.status).toBe(204);
    expect(
      (
        await request(service().getHttpServer())
          .get(`/internal/v1/documents/${documentId}`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(404);
    const client = await database().connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.system_access', 'on', true)");
      const receipt = await client.query(
        'select snapshot from document_create_receipts where document_id = $1',
        [documentId],
      );
      expect(receipt.rows).toEqual([{ snapshot: null }]);
      const facts = await client.query<{ event_name: string; payload: unknown }>(
        'select event_name, payload from outbox_events where organization_id = $1 order by created_at',
        [organizationId],
      );
      expect(facts.rows.map((fact) => fact.event_name)).toEqual([
        'doc.created.v1',
        'doc.deleted.v1',
      ]);
      expect(JSON.stringify(facts.rows)).not.toContain('# Version');
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('searches literal special characters and returns metadata only', async () => {
    const token = await bearer(organizationId);
    const created = await request(service().getHttpServer())
      .post('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ spaceId, title: 'Literal %_\\ example', body: 'private source' });
    expect(created.status).toBe(201);
    for (const q of ['%', '_', '\\']) {
      const result = await request(service().getHttpServer())
        .get('/internal/v1/documents')
        .set('Authorization', `Bearer ${token}`)
        .query({ q });
      expect(result.status).toBe(200);
      const page = JSON.parse(result.text) as { items: { title: string; body?: string }[] };
      expect(page.items.map((item) => item.title)).toEqual(['Literal %_\\ example']);
      expect(page.items[0]).not.toHaveProperty('body');
    }
    const absent = await request(service().getHttpServer())
      .get('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .query({ q: 'absent%' });
    expect((JSON.parse(absent.text) as { items: unknown[] }).items).toEqual([]);
  });

  it('rejects an in-flight create and allows exactly one creation after the lock releases', async () => {
    const token = await bearer(organizationId);
    const key = 'fixture-concurrent';
    const body = { spaceId, title: 'Concurrent fixture', body: 'once' };
    const digest = createHash('sha256').update(key, 'utf8').digest('hex');
    const lockName = `${organizationId}:${userId.toLowerCase()}:${digest}`;
    const client = await database().connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockName]);
      const conflict = await request(service().getHttpServer())
        .post('/internal/v1/documents')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send(body);
      expect(conflict.status).toBe(409);
      expect((JSON.parse(conflict.text) as { code: string }).code).toBe(
        'idempotency.request-in-progress',
      );
    } finally {
      await client.query('rollback');
      client.release();
    }
    const created = await request(service().getHttpServer())
      .post('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(created.status).toBe(201);
    const replay = await request(service().getHttpServer())
      .post('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    const countClient = await database().connect();
    try {
      await countClient.query('begin');
      await countClient.query("select set_config('app.system_access', 'on', true)");
      const rows = await countClient.query('select id from documents where title = $1', [
        body.title,
      ]);
      expect(rows.rowCount).toBe(1);
      await countClient.query('rollback');
    } finally {
      countClient.release();
    }
  });

  it('finds readable matches beyond hidden batches without exposing a continuation', async () => {
    const client = await database().connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.system_access', 'on', true)");
      await client.query(
        `insert into documents
          (organization_id, id, space_id, version, status, title, body, author_user_id, created_at, updated_at)
         select $1, uuidv7(), $2, 1, 'active', 'deep-visibility hidden-only', '', $3,
                now(), now() + interval '1 day'
           from generate_series(1, 105)`,
        [organizationId, hiddenSpaceId, userId],
      );
      await client.query(
        `insert into documents
          (organization_id, id, space_id, version, status, title, body, author_user_id, created_at, updated_at)
         values ($1, uuidv7(), $2, 1, 'active', 'deep-visibility readable', '', $3, now(), now())`,
        [organizationId, spaceId, userId],
      );
      await client.query('commit');
    } finally {
      client.release();
    }
    const token = await bearer(organizationId);
    const result = await request(service().getHttpServer())
      .get('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .query({ q: 'deep-visibility', limit: 1 });
    expect(result.status).toBe(200);
    const page = JSON.parse(result.text) as { items: { title: string }[]; nextCursor: unknown };
    expect(page.items.map((item) => item.title)).toEqual(['deep-visibility readable']);
    expect(page.nextCursor).toBeNull();
    const hidden = await request(service().getHttpServer())
      .get('/internal/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .query({ q: 'hidden-only', limit: 1 });
    expect(hidden.status).toBe(200);
    expect(hidden.body).toEqual({ items: [], nextCursor: null });
  });

  it('rolls back the document and replay receipt if the outbox insert fails', async () => {
    const token = await bearer(organizationId);
    await database().query(
      "alter table outbox_events add constraint fixture_reject_document_fact check (event_name <> 'doc.created.v1') not valid",
    );
    try {
      const result = await request(service().getHttpServer())
        .post('/internal/v1/documents')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'fixture-rollback')
        .send({ spaceId, title: 'Transaction fixture', body: '' });
      expect(result.status).toBe(503);
      expect((JSON.parse(result.text) as { code: string }).code).toBe('document.unavailable');
      const client = await database().connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.system_access', 'on', true)");
        const rows = await client.query('select id from documents where title = $1', [
          'Transaction fixture',
        ]);
        const receipts = await client.query(
          'select document_id from document_create_receipts where snapshot ->> $1 = $2',
          ['title', 'Transaction fixture'],
        );
        expect(rows.rows).toHaveLength(0);
        expect(receipts.rows).toHaveLength(0);
        await client.query('rollback');
      } finally {
        client.release();
      }
    } finally {
      await database().query(
        'alter table outbox_events drop constraint fixture_reject_document_fact',
      );
    }
  });

  it('requires the verified Search issuer, system actor, audience and organization for projections', async () => {
    const organizationId = projectionOrganizationId;
    const systemActor = { type: 'system' as const, id: 'search-service' };
    const denied: readonly [string | undefined, number][] = [
      [undefined, 401],
      [await signer.sign('document-service', { actor: systemActor, organizationId }), 403],
      [
        await searchSigner.sign('document-service', {
          actor: { type: 'user', id: userId },
          organizationId,
        }),
        403,
      ],
      [
        await searchSigner.sign('document-service', {
          actor: { type: 'system', id: 'a-different-service' },
          organizationId,
        }),
        403,
      ],
      [
        await searchSigner.sign('document-service', { actor: systemActor, organizationId: null }),
        403,
      ],
      [await searchSigner.sign('task-service', { actor: systemActor, organizationId }), 401],
    ];
    for (const [token, status] of denied) {
      const list = request(service().getHttpServer()).get(projectionPath);
      if (token !== undefined) list.set('Authorization', `Bearer ${token}`);
      await list.expect(status).expect('Cache-Control', 'private, no-store');
    }

    const token = await projectionBearer(organizationId);
    await request(service().getHttpServer())
      .get(projectionPath)
      .set('Authorization', `Bearer ${token}`)
      .query({ organizationId: otherOrganizationId })
      .expect(400)
      .expect('Cache-Control', 'private, no-store');
    const documentId = '01900000-0000-7000-8000-00000000000a';
    await request(service().getHttpServer())
      .post(`${projectionPath}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [documentId, documentId.toUpperCase()] })
      .expect(400)
      .expect('Cache-Control', 'private, no-store');
  });

  it('measures escaped UTF-8 before returning a bounded page and resumes within the original UUID fence', async () => {
    const organization = projectionOrganizationId;
    const first = {
      documentId: '01900000-0000-7000-8000-000000000001',
      spaceId,
      version: 7,
      title: 'Quoted " title É',
      body: '\u0001'.repeat(90_000) + '😀'.repeat(5_000),
    };
    const second = {
      ...first,
      documentId: '01900000-0000-7000-8000-000000000002',
      body: '',
    };
    const bytesWithEmptySecond = Buffer.byteLength(
      JSON.stringify({ items: [first, second], nextCursor: null }),
    );
    const remainder = maximumProjectionBytes - bytesWithEmptySecond;
    second.body = '\u0001'.repeat(Math.floor(remainder / 6)) + 'a'.repeat(remainder % 6);
    expect(Buffer.byteLength(JSON.stringify({ items: [first, second], nextCursor: null }))).toBe(
      maximumProjectionBytes,
    );
    const fence = {
      ...first,
      documentId: '01900000-0000-7000-8000-000000000003',
      body: '\r\n"\\',
    };
    const beyondFence = { ...fence, documentId: '01900000-0000-7000-8000-000000000004' };
    await insertProjectionSource(organization, first);
    await insertProjectionSource(organization, second);
    await insertProjectionSource(organization, fence);
    await insertProjectionSource(otherOrganizationId, beyondFence);
    const token = await projectionBearer(organization);
    const response = await request(service().getHttpServer())
      .get(projectionPath)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', '*')
      .query({ limit: 100 })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(Buffer.byteLength(response.text)).toBeLessThanOrEqual(maximumProjectionBytes);
    const page = JSON.parse(response.text) as DocumentSearchProjectionPage;
    expect(page.items.map((item) => item.documentId)).toEqual([first.documentId]);
    expect(page.items[0]?.body === first.body).toBe(true);
    const cursor = page.nextCursor;
    if (cursor === null) throw new Error('Expected a continuation for the remaining documents.');

    await insertProjectionSource(organization, beyondFence);
    await service().close();
    app = await makeApp();
    const resumed = await request(service().getHttpServer())
      .get(projectionPath)
      .set('Authorization', `Bearer ${await projectionBearer(organization)}`)
      .query({ cursor, limit: 100 })
      .expect(200);
    expect(Buffer.byteLength(resumed.text)).toBeLessThanOrEqual(maximumProjectionBytes);
    const last = JSON.parse(resumed.text) as DocumentSearchProjectionPage;
    expect(last.items.map((item) => item.documentId)).toEqual([
      second.documentId,
      fence.documentId,
    ]);
    expect(last.items[0]?.body === second.body).toBe(true);
    expect(last.items[1]?.body).toBe(fence.body);
    expect(last.nextCursor).toBeNull();
    await request(service().getHttpServer())
      .get(projectionPath)
      .set('Authorization', `Bearer ${await projectionBearer(otherOrganizationId)}`)
      .query({ cursor })
      .expect(400)
      .expect('Cache-Control', 'private, no-store');

    const overBudget = await request(service().getHttpServer())
      .post(`${projectionPath}/resolve`)
      .set('Authorization', `Bearer ${await projectionBearer(organization)}`)
      .send({ documentIds: [first.documentId, second.documentId] })
      .expect(422)
      .expect('Cache-Control', 'private, no-store');
    expect(overBudget.body).toMatchObject({ code: 'document.projection-batch-too-large' });
    expect(overBudget.body).not.toHaveProperty('results');
  });

  it('resolves current legacy rows, no-op revisions and deletion fences in input order', async () => {
    const organization = projectionOrganizationId;
    const legacy = {
      documentId: '01900000-0000-7000-8000-00000000000a',
      spaceId,
      version: 8,
      title: 'Legacy source',
      body: 'Existing source without an outbox event.',
    };
    const foreign = { ...legacy, documentId: '01900000-0000-7000-8000-00000000000b' };
    const stillPresent = { ...legacy, documentId: '01900000-0000-7000-8000-00000000000c' };
    const unknownId = '01900000-0000-7000-8000-00000000000d';
    await insertProjectionSource(organization, legacy);
    await insertProjectionSource(otherOrganizationId, foreign);
    await insertProjectionSource(organization, stillPresent);

    const userToken = await bearer(organization);
    await request(service().getHttpServer())
      .patch(`/internal/v1/documents/${legacy.documentId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('If-Match', '"8"')
      .send({ title: legacy.title, body: legacy.body })
      .expect(200)
      .expect('ETag', '"8"');
    const searchToken = await projectionBearer(organization);
    const current = await request(service().getHttpServer())
      .post(`${projectionPath}/resolve`)
      .set('Authorization', `Bearer ${searchToken}`)
      .send({ documentIds: [legacy.documentId.toUpperCase()] })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(JSON.parse(current.text) as DocumentSearchProjectionResults).toEqual({
      results: [{ status: 'present', projection: legacy }],
    });
    await request(service().getHttpServer())
      .delete(`/internal/v1/documents/${legacy.documentId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('If-Match', '"8"')
      .expect(204);
    const resolved = await request(service().getHttpServer())
      .post(`${projectionPath}/resolve`)
      .set('Authorization', `Bearer ${searchToken}`)
      .send({
        documentIds: [foreign.documentId, legacy.documentId, unknownId, stillPresent.documentId],
      })
      .expect(200);
    expect(JSON.parse(resolved.text) as DocumentSearchProjectionResults).toEqual({
      results: [
        { status: 'absent', documentId: foreign.documentId, version: null },
        { status: 'absent', documentId: legacy.documentId, version: 9 },
        { status: 'absent', documentId: unknownId, version: null },
        { status: 'present', projection: stillPresent },
      ],
    });
  });
});

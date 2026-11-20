import { generateKeyPairSync } from 'node:crypto';
import type { Server } from 'node:http';

import { createApplication, InternalTokenSigner, SkipInternalToken } from '@cadenway/nest-common';
import type { Ed25519PublicJwk } from '@cadenway/nest-common';
import { Controller, Get, Header, Module, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureDocumentPrivateHttp } from './document-private-http.js';

const documentCollection = '/internal/v1/documents';
const documentUrl = `${documentCollection}/019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17`;
const lastModified = 'Wed, 01 Jan 2020 00:00:00 GMT';
const cacheControl = 'private, no-store';

@Controller()
class DocumentHttpFixture {
  // #region Methods
  /** Returns a catalog page without a document version. */
  @Get(documentCollection)
  public list(): { readonly items: readonly string[] } {
    return { items: [] };
  }

  /** Returns a document version so the kit supplies a strong ETag. */
  @Get(`${documentCollection}/:documentId`)
  @Header('Last-Modified', lastModified)
  public read(): { readonly version: number } {
    return { version: 7 };
  }

  /** Registers a create route behind the shared parser. */
  @Post(documentCollection)
  public create(): { readonly version: number } {
    return { version: 1 };
  }

  /** Provides an unrelated route for the scope check. */
  @Get('/health/live')
  @SkipInternalToken()
  public live(): { readonly status: string } {
    return { status: 'ok' };
  }
  // #endregion
}

@Module({ controllers: [DocumentHttpFixture] })
class HttpFixtureModule {}

describe('document HTTP privacy', () => {
  let app: NestExpressApplication | undefined;
  let server: Server;
  let authorization: string;

  beforeAll(async () => {
    const { x, d } = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    if (x === undefined || d === undefined) {
      throw new Error('Node returned an Ed25519 JWK without its key material.');
    }
    const publicJwk: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', kid: 'api-gateway-test', x };
    const signer = await InternalTokenSigner.create({
      issuer: 'api-gateway',
      privateJwk: { ...publicJwk, d },
    });
    const token = await signer.sign('document-service', {
      actor: { type: 'user', id: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30' },
      organizationId: '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10',
    });
    authorization = `Bearer ${token}`;
    app = await createApplication(HttpFixtureModule, {
      service: 'document-service',
      config: { LOG_LEVEL: 'silent' },
      internalToken: {
        verifier: {
          audience: 'document-service',
          trustedIssuers: { 'api-gateway': [publicJwk] },
        },
      },
      jsonBodyLimitBytes: 32,
    });
    configureDocumentPrivateHttp(app);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(['*', '"7"'])('returns the current document for If-None-Match %s', async (condition) => {
    await request(server)
      .get(documentUrl)
      .set('Authorization', authorization)
      .set('If-None-Match', condition)
      .expect('Cache-Control', cacheControl)
      .expect('ETag', '"7"')
      .expect(200, { version: 7 });
  });

  it('returns a current collection page even for a wildcard conditional read', async () => {
    await request(server)
      .get(`${documentCollection}/?q=private`)
      .set('Authorization', authorization)
      .set('If-None-Match', '*')
      .expect('Cache-Control', cacheControl)
      .expect(200, { items: [] });
  });

  it('returns the current document even for a matching If-Modified-Since', async () => {
    await request(server)
      .get(documentUrl)
      .set('Authorization', authorization)
      .set('If-Modified-Since', lastModified)
      .expect('Cache-Control', cacheControl)
      .expect(200, { version: 7 });
  });

  it('keeps the current strong ETag on a private HEAD response', async () => {
    await request(server)
      .head(documentUrl)
      .set('Authorization', authorization)
      .set('If-None-Match', '*')
      .expect('Cache-Control', cacheControl)
      .expect('ETag', '"7"')
      .expect(200);
  });

  it('marks a guard rejection private and no-store', async () => {
    const response = await request(server)
      .get(documentUrl)
      .set('If-None-Match', '*')
      .expect('Cache-Control', cacheControl)
      .expect('Content-Type', /application\/problem\+json/u)
      .expect(401);
    expect(response.body).toMatchObject({ code: 'auth.token-missing' });
  });

  it('reports a bad percent-encoded path as private invalid input', async () => {
    const response = await request(server)
      .get(`${documentCollection}/%E0%A4`)
      .set('Authorization', authorization)
      .expect('Cache-Control', cacheControl)
      .expect('Content-Type', /application\/problem\+json/u)
      .expect(400);
    expect(response.body).toMatchObject({
      code: 'request.invalid',
      details: { issues: [{ in: 'path', path: 'documentId', code: 'invalid_format' }] },
    });
  });

  it('marks malformed JSON rejected by the shared parser private and no-store', async () => {
    const response = await request(server)
      .post(documentCollection)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect('Cache-Control', cacheControl)
      .expect('Content-Type', /application\/problem\+json/u)
      .expect(400);
    expect(response.body).toMatchObject({
      code: 'request.invalid',
      details: { issues: [{ in: 'body', code: 'invalid_json' }] },
    });
  });

  it('keeps the shared response for an oversized body private and no-store', async () => {
    const response = await request(server)
      .post(documentCollection)
      .send({ body: 'a'.repeat(40) })
      .expect('Cache-Control', cacheControl)
      .expect('Content-Type', /application\/problem\+json/u)
      .expect(400);
    expect(response.body).toMatchObject({ code: 'request.body-too-large' });
  });

  it('leaves conditional freshness on an unrelated route', async () => {
    const response = await request(server)
      .get('/health/live')
      .set('If-None-Match', '*')
      .expect(304);
    expect(response.headers).not.toHaveProperty('cache-control');
  });
});

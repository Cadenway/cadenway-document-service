import {
  InternalHttpClient,
  InternalTokenSigner,
  InternalTokenVerifier,
  runWithOrganizationContext,
} from '@cadenway/nest-common';
import type { OrganizationContext } from '@cadenway/nest-common';
import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { TaskDocumentSpaceAccessAdapter } from './task-document-space-access.adapter.js';

const actorUserId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b31';
const context: OrganizationContext = {
  organizationId,
  actor: { type: 'user', id: actorUserId },
  role: 'member',
  scopes: [],
};
const first = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e01';
const hidden = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e02';
const last = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e03';
const input = { actorUserId, organizationId, spaceIds: [first.toUpperCase(), hidden, first, last] };
const noStore = { 'Cache-Control': 'no-store' };

describe('TaskDocumentSpaceAccessAdapter', () => {
  let signer: InternalTokenSigner;
  let verifier: InternalTokenVerifier;

  beforeAll(async () => {
    const { d, x } = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    if (d === undefined || x === undefined) throw new Error('Missing ephemeral test key.');
    signer = await InternalTokenSigner.create({
      issuer: 'document-service',
      privateJwk: { kid: 'fixture', kty: 'OKP', crv: 'Ed25519', d, x },
    });
    verifier = await InternalTokenVerifier.create({
      audience: 'task-service',
      trustedIssuers: { 'document-service': [{ kid: 'fixture', kty: 'OKP', crv: 'Ed25519', x }] },
    });
  });

  function adapter(fetch: typeof globalThis.fetch): TaskDocumentSpaceAccessAdapter {
    return new TaskDocumentSpaceAccessAdapter(
      new InternalHttpClient({
        service: 'task-service',
        baseUrl: 'http://task-service.test:3013',
        signer,
        fetch,
      }),
    );
  }

  it('signs the verified user and organization and sends only the requested IDs', async () => {
    const results = [
      { spaceId: first, role: 'edit' },
      { spaceId: last, role: 'comment' },
    ];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ results }, { headers: noStore }));

    await expect(
      runWithOrganizationContext(context, () => adapter(fetch).resolve(input)),
    ).resolves.toEqual(results);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toEqual(new URL('http://task-service.test:3013/internal/v1/spaces/access/resolve'));
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ spaceIds: input.spaceIds }),
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    const principal = await verifier.verify(
      headers.get('Authorization')?.replace(/^Bearer /u, '') ?? '',
    );
    expect(principal).toMatchObject({
      issuer: 'document-service',
      audience: 'task-service',
      actor: context.actor,
      organizationId,
      role: 'member',
    });
  });

  it('checks membership even for an empty scan', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ results: [] }, { headers: noStore }));
    await expect(
      runWithOrganizationContext(context, () => adapter(fetch).resolve({ ...input, spaceIds: [] })),
    ).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: '{"spaceIds":[]}' }),
    );
  });

  it.each([
    { ...input, actorUserId: last },
    { ...input, organizationId: last },
    { ...input, spaceIds: ['malformed'] },
  ])('rejects a mismatch or malformed local request before signing', async (unexpected) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      runWithOrganizationContext(context, () => adapter(fetch).resolve(unexpected)),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(
    [
      [{ spaceId: first, role: 'owner' }],
      [{ spaceId: 'malformed', role: 'edit' }],
      [{ spaceId: first.toUpperCase(), role: 'edit' }],
      [{ spaceId: actorUserId, role: 'edit' }],
      [
        { spaceId: first, role: 'view' },
        { spaceId: first, role: 'edit' },
      ],
      [
        { spaceId: last, role: 'view' },
        { spaceId: first, role: 'view' },
      ],
    ].map((results) => ({ results })),
  )('rejects the whole decision when a result is invalid', async (body) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(body, { headers: noStore }));
    await expect(
      runWithOrganizationContext(context, () => adapter(fetch).resolve(input)),
    ).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it.each([
    () => Response.json({ results: [] }),
    () => new Response('not JSON', { headers: noStore }),
    () => new Response(null, { status: 204, headers: noStore }),
  ])('rejects unverified success responses', async (response) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response());
    await expect(
      runWithOrganizationContext(context, () => adapter(fetch).resolve(input)),
    ).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it.each([
    ['organization.not-found', 'organization-not-found'],
    ['unexpected', 'unavailable'],
  ])('translates only the published inactive-organization refusal', async (code, reason) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      Response.json(
        {
          type: 'about:blank',
          status: 404,
          title: 'Not found',
          code,
          detail: 'Not forwarded',
        },
        { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );
    const failure: unknown = await runWithOrganizationContext(context, () =>
      adapter(fetch).resolve(input),
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason, message: reason });
  });
});

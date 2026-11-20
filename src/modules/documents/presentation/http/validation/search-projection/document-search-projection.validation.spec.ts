import { ZodValidationPipe } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import {
  DocumentSearchProjectionListQuery,
  DocumentSearchProjectionResolveBody,
} from './document-search-projection.validation.js';

const query = new ZodValidationPipe(DocumentSearchProjectionListQuery);
const body = new ZodValidationPipe(DocumentSearchProjectionResolveBody);
const documentId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17';
const otherId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f18';

describe('Document Search projection validation', () => {
  it('uses the contract defaults and parses a single decimal page limit', () => {
    expect(query.transform({}, { type: 'query' })).toEqual({ limit: 50 });
    expect(query.transform({ cursor: 'opaque', limit: '100' }, { type: 'query' })).toEqual({
      cursor: 'opaque',
      limit: 100,
    });
  });

  it.each([[''], ['0'], ['101'], ['1e2'], [['5']]])('rejects an invalid page limit %j', (limit) => {
    expect(() => query.transform({ limit }, { type: 'query' })).toThrow('request.invalid');
  });

  it('rejects a tenant supplied as an unrelated query parameter', async () => {
    await expect(
      Promise.resolve().then(() => query.transform({ organizationId: otherId }, { type: 'query' })),
    ).rejects.toMatchObject({
      problem: {
        status: 400,
        code: 'request.invalid',
        details: { issues: [{ in: 'query', path: 'organizationId' }] },
      },
    });
  });

  it('normalizes UUID case and preserves the requested order', () => {
    expect(
      body.transform({ documentIds: [otherId.toUpperCase(), documentId] }, { type: 'body' }),
    ).toEqual({ documentIds: [otherId, documentId] });
  });

  it('rejects case variants of the same document UUID', async () => {
    await expect(
      Promise.resolve().then(() =>
        body.transform({ documentIds: [documentId, documentId.toUpperCase()] }, { type: 'body' }),
      ),
    ).rejects.toMatchObject({
      problem: {
        status: 400,
        code: 'request.invalid',
        details: { issues: [{ in: 'body', path: 'documentIds' }] },
      },
    });
  });

  it.each([
    { documentIds: [] },
    { documentIds: Array.from({ length: 101 }, () => documentId) },
    { documentIds: ['123e4567-e89b-42d3-a456-426614174000'] },
    { documentIds: [documentId], organizationId: otherId },
  ])('rejects invalid resolve bodies', (input) => {
    expect(() => body.transform(input, { type: 'body' })).toThrow('request.invalid');
  });
});

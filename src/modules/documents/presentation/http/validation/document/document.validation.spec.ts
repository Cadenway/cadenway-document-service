import { ZodValidationPipe } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import {
  DocumentPatchBody,
  DocumentListQuery,
  documentExpectedVersion,
  documentIdempotencyKey,
} from './document.validation.js';

describe('document request validation', () => {
  it('accepts only one canonical strong version for a write', () => {
    expect(documentExpectedVersion('"12"')).toBe(12);
    for (const value of [undefined, '*', 'W/"1"', '"01"', '"1", "2"', '"0"']) {
      expect(() => documentExpectedVersion(value)).toThrow('request.invalid');
    }
  });

  it('requires one patch field and rejects unexpected members', () => {
    const pipe = new ZodValidationPipe(DocumentPatchBody);
    const metadata = { type: 'body' as const };
    expect(() => pipe.transform({}, metadata)).toThrow();
    expect(() => pipe.transform({ spaceId: 'unexpected' }, metadata)).toThrow();
    expect(pipe.transform({ body: '' }, metadata)).toEqual({ body: '' });
  });

  it('rejects malformed Unicode and NUL in the catalog query', () => {
    const pipe = new ZodValidationPipe(DocumentListQuery);
    const metadata = { type: 'query' as const };
    expect(() => pipe.transform({ q: 'bad\0query' }, metadata)).toThrow('request.invalid');
    expect(() => pipe.transform({ q: '\ud800' }, metadata)).toThrow('request.invalid');
    expect(pipe.transform({ q: 'Nouveautés' }, metadata)).toEqual({ q: 'Nouveautés', limit: 50 });
    expect(() => pipe.transform({ unexpected: 'x' }, metadata)).toThrow('request.invalid');
  });

  it('validates the optional creation key without changing its value', () => {
    expect(documentIdempotencyKey(undefined)).toBeUndefined();
    expect(documentIdempotencyKey('request-42')).toBe('request-42');
    expect(() => documentIdempotencyKey('')).toThrow();
    expect(() => documentIdempotencyKey('x'.repeat(256))).toThrow();
  });
});

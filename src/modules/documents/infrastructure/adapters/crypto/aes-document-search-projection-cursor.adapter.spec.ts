import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { AesDocumentSearchProjectionCursor } from './aes-document-search-projection-cursor.adapter.js';

const key = Buffer.alloc(32, 7);
const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b31';
const otherOrganizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b32';
const position = {
  lastId: '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17',
  upperBound: '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f18',
};
const reversed = { lastId: position.upperBound, upperBound: position.lastId };
const nonV7 = { ...position, lastId: '019a7005-4b2c-4d4e-8f5a-6b7c8d9e0f17' };

describe('AesDocumentSearchProjectionCursor', () => {
  it('preserves both UUIDs across replicas with fresh encryption for each token', () => {
    const issuer = new AesDocumentSearchProjectionCursor(key);
    const replica = new AesDocumentSearchProjectionCursor(Buffer.from(key));
    const cursor = issuer.encode(organizationId, position);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]{82}$/u);
    expect(issuer.encode(organizationId, position)).not.toBe(cursor);
    expect(replica.decode(organizationId.toUpperCase(), cursor)).toStrictEqual(position);
  });

  it('allows equal bounds and normalizes UUID casing', () => {
    const codec = new AesDocumentSearchProjectionCursor(key);
    const cursor = codec.encode(organizationId, {
      lastId: position.lastId.toUpperCase(),
      upperBound: position.lastId,
    });

    expect(codec.decode(organizationId, cursor)).toStrictEqual({
      lastId: position.lastId,
      upperBound: position.lastId,
    });
  });

  it('rejects a token for another organization or encrypted with another key', () => {
    const codec = new AesDocumentSearchProjectionCursor(key);
    const cursor = codec.encode(organizationId, position);
    const other = new AesDocumentSearchProjectionCursor(Buffer.alloc(32, 8));

    expect(() => codec.decode(otherOrganizationId, cursor)).toThrow(
      'Invalid document search projection cursor.',
    );
    expect(() => other.decode(organizationId, cursor)).toThrow(
      'Invalid document search projection cursor.',
    );
  });

  it('rejects malformed, tampered, and noncanonical representations uniformly', () => {
    const codec = new AesDocumentSearchProjectionCursor(key);
    const cursor = codec.encode(organizationId, position);
    const tampered = Buffer.from(cursor, 'base64url');
    tampered.writeUInt8(tampered.readUInt8(35) ^ 1, 35);
    const wrongVersion = Buffer.from(cursor, 'base64url');
    wrongVersion.writeUInt8(2, 0);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const alias = cursor.slice(0, -1) + alphabet.charAt(alphabet.indexOf(cursor.slice(-1)) + 1);
    expect(Buffer.from(alias, 'base64url')).toEqual(Buffer.from(cursor, 'base64url'));

    for (const candidate of [
      tampered.toString('base64url'),
      wrongVersion.toString('base64url'),
      alias,
      cursor + '=',
      cursor.slice(1),
    ]) {
      expect(() => codec.decode(organizationId, candidate)).toThrow(
        'Invalid document search projection cursor.',
      );
    }
  });

  it.each([reversed, nonV7])('rejects invalid UUIDv7 positions when encoding', (invalid) => {
    const codec = new AesDocumentSearchProjectionCursor(key);
    expect(() => codec.encode(organizationId, invalid)).toThrow(
      'Invalid document search projection cursor position.',
    );
  });

  it.each([reversed, nonV7])('validates UUIDv7 positions after authentication', (invalid) => {
    const codec = new AesDocumentSearchProjectionCursor(key);
    const nonce = Buffer.alloc(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(
      Buffer.from(
        JSON.stringify(['cadenway:document:search-projection:cursor:v1', organizationId]),
      ),
    );
    const payload = Buffer.from((invalid.lastId + invalid.upperBound).replaceAll('-', ''), 'hex');
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const cursor = Buffer.concat([Buffer.of(1), nonce, cipher.getAuthTag(), ciphertext]).toString(
      'base64url',
    );

    expect(() => codec.decode(organizationId, cursor)).toThrow(
      'Invalid document search projection cursor.',
    );
  });
});

import { describe, expect, it } from 'vitest';

import { AesDocumentCursorAdapter } from './aes-document-cursor.adapter.js';

const key = Buffer.alloc(32, 7);
const scope = {
  organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b31',
  actorUserId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
  query: 'export csv',
};
const position = {
  id: '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17',
  updatedAt: new Date('2026-11-09T17:20:00.234Z'),
};

describe('AesDocumentCursorAdapter', () => {
  it('preserves the millisecond and id across replicas without exposing either', () => {
    const first = new AesDocumentCursorAdapter(key);
    const second = new AesDocumentCursorAdapter(key);
    const cursor = first.encode({ ...scope, position });
    const newCursor = first.encode({ ...scope, position });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]{71}$/u);
    expect(newCursor).toHaveLength(cursor.length);
    expect(newCursor).not.toBe(cursor);
    expect(cursor).not.toContain(position.id);
    expect(cursor).not.toContain(scope.query);
    expect(second.decode({ ...scope, cursor })).toStrictEqual(position);
  });

  it('binds to the same UUIDs irrespective of letter case', () => {
    const codec = new AesDocumentCursorAdapter(key);
    const cursor = codec.encode({ ...scope, position });
    expect(
      codec.decode({
        ...scope,
        organizationId: scope.organizationId.toUpperCase(),
        actorUserId: scope.actorUserId.toUpperCase(),
        cursor,
      }),
    ).toStrictEqual(position);
  });

  it.each([
    { ...scope, actorUserId: position.id },
    { ...scope, organizationId: position.id },
    { ...scope, query: 'sprint 14' },
  ])('rejects a cursor reused outside its authenticated scope', (differentScope) => {
    const codec = new AesDocumentCursorAdapter(key);
    const cursor = codec.encode({ ...scope, position });
    expect(() => codec.decode({ ...differentScope, cursor })).toThrow('invalid-cursor');
  });

  it('rejects a cursor authenticated with a different key', () => {
    const cursor = new AesDocumentCursorAdapter(key).encode({ ...scope, position });
    const other = new AesDocumentCursorAdapter(Buffer.alloc(32, 8));
    expect(() => other.decode({ ...scope, cursor })).toThrow('invalid-cursor');
  });

  it('rejects tampering, a changed version and noncanonical encoding uniformly', () => {
    const codec = new AesDocumentCursorAdapter(key);
    const cursor = codec.encode({ ...scope, position });
    const tampered = Buffer.from(cursor, 'base64url');
    tampered.writeUInt8(tampered.readUInt8(35) ^ 1, 35);
    const wrongVersion = Buffer.from(cursor, 'base64url');
    wrongVersion.writeUInt8(2, 0);

    for (const candidate of [
      tampered.toString('base64url'),
      wrongVersion.toString('base64url'),
      cursor + '=',
      cursor.slice(1),
    ]) {
      expect(() => codec.decode({ ...scope, cursor: candidate })).toThrow('invalid-cursor');
    }
  });
});

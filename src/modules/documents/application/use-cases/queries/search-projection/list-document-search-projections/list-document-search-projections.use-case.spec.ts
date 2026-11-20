import { describe, expect, it, vi } from 'vitest';

import type { DocumentSearchProjectionCursor } from '../../../../ports/outbound/pagination/search-projection/document-search-projection-cursor.port.js';
import type { DocumentSearchProjectionReader } from '../../../../ports/outbound/persistence/search-projection/document-search-projection-reader.port.js';
import { ListDocumentSearchProjections } from './list-document-search-projections.use-case.js';

const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const limit = 10;
const maximumBytes = 1_048_576;
const cursor = 'a'.repeat(82);

function projection(id: number, body: string) {
  return {
    documentId: '019a7005-4b2c-7d4e-8f5a-' + id.toString().padStart(12, '0'),
    spaceId: '123e4567-e89b-42d3-a456-426614174000',
    version: 1,
    title: 'Roadmap',
    body,
  };
}

function pageBytes(items: readonly ReturnType<typeof projection>[], nextCursor: string | null) {
  return Buffer.byteLength(JSON.stringify({ items, nextCursor }), 'utf8');
}

function itemsAtByteLimit(nextCursor: string | null) {
  const items = Array.from({ length: 5 }, (_value, index) =>
    projection(index + 1, '🚀'.repeat(45_000)),
  );
  const last = projection(6, '"\n');
  const room = maximumBytes - pageBytes([...items, last], nextCursor);
  last.body += '🚀'.repeat(Math.floor(room / 4)) + 'a'.repeat(room % 4);
  return [...items, last];
}

function fixture() {
  const reader = {
    list: vi.fn<DocumentSearchProjectionReader['list']>(),
    resolve: vi.fn<DocumentSearchProjectionReader['resolve']>(),
  };
  const cursors = {
    encode: vi.fn<DocumentSearchProjectionCursor['encode']>().mockReturnValue(cursor),
    decode: vi.fn<DocumentSearchProjectionCursor['decode']>(),
  };
  return { reader, cursors, query: new ListDocumentSearchProjections(reader, cursors) };
}

describe('ListDocumentSearchProjections', () => {
  it('returns a page of exactly 1 MiB including UTF-8 content and continuation', async () => {
    const { reader, cursors, query } = fixture();
    const items = itemsAtByteLimit(cursor);
    const upperBound = projection(7, '').documentId;
    reader.list.mockResolvedValue({ items, upperBound, hasMore: true });

    const page = await query.execute({ organizationId, limit });

    expect(pageBytes(items, cursor)).toBe(maximumBytes);
    expect(page).toStrictEqual({ items, nextCursor: cursor });
    expect(reader.list).toHaveBeenCalledExactlyOnceWith(organizationId, {
      position: undefined,
      limit,
      maximumBytes,
    });
    expect(cursors.encode).toHaveBeenCalledExactlyOnceWith(organizationId, {
      lastId: projection(6, '').documentId,
      upperBound,
    });
  });

  it('trims a page that fits only without the cursor and resumes from the last emitted row', async () => {
    const { reader, cursors, query } = fixture();
    const items = itemsAtByteLimit(null);
    const last = projection(7, '');
    const retained = items.slice(0, 5);
    const position = {
      lastId: projection(5, '').documentId,
      upperBound: last.documentId,
    };
    const remaining = [...items.slice(5), last];
    reader.list
      .mockResolvedValueOnce({ items, upperBound: last.documentId, hasMore: true })
      .mockResolvedValueOnce({ items: remaining, upperBound: last.documentId, hasMore: false });
    cursors.decode.mockReturnValue(position);

    expect(pageBytes(items, null)).toBe(maximumBytes);
    expect(pageBytes(items, cursor)).toBeGreaterThan(maximumBytes);
    const page = await query.execute({ organizationId, limit });
    expect(page).toStrictEqual({ items: retained, nextCursor: cursor });
    expect(cursors.encode).toHaveBeenLastCalledWith(organizationId, position);

    const continuation = await query.execute({ organizationId, limit, cursor });

    expect(continuation).toStrictEqual({ items: remaining, nextCursor: null });
    expect(cursors.decode).toHaveBeenCalledExactlyOnceWith(organizationId, cursor);
    expect(reader.list).toHaveBeenNthCalledWith(2, organizationId, {
      position,
      limit,
      maximumBytes,
    });
  });

  it('reports unavailability before reading when a stable cursor codec is missing', async () => {
    const { reader } = fixture();
    const query = new ListDocumentSearchProjections(reader, null);

    await expect(query.execute({ organizationId, limit })).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(reader.list).not.toHaveBeenCalled();
  });

  it('rejects an invalid cursor before reading documents', async () => {
    const { reader, cursors, query } = fixture();
    cursors.decode.mockImplementation(() => {
      throw new Error('Invalid cursor envelope.');
    });

    await expect(query.execute({ organizationId, limit, cursor })).rejects.toMatchObject({
      reason: 'invalid-cursor',
    });
    expect(reader.list).not.toHaveBeenCalled();
  });
});

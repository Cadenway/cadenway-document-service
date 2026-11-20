import { describe, expect, it, vi } from 'vitest';

import type { DocumentSearchProjectionReader } from '../../../../ports/outbound/persistence/search-projection/document-search-projection-reader.port.js';
import { ResolveDocumentSearchProjections } from './resolve-document-search-projections.use-case.js';

const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const deletedId = '019a7005-4b2c-7d4e-8f5a-000000000010';
const unknownId = '019a7005-4b2c-7d4e-8f5a-000000000011';
const maximumBytes = 1_048_576;

function present(id: number, body = 'Document body') {
  return {
    status: 'present' as const,
    projection: {
      documentId: '019a7005-4b2c-7d4e-8f5a-' + id.toString().padStart(12, '0'),
      spaceId: '123e4567-e89b-42d3-a456-426614174000',
      version: 3,
      title: 'Roadmap',
      body,
    },
  };
}

function fixture() {
  const reader = {
    list: vi.fn<DocumentSearchProjectionReader['list']>(),
    resolve: vi.fn<DocumentSearchProjectionReader['resolve']>(),
  };
  return { reader, query: new ResolveDocumentSearchProjections(reader) };
}

describe('ResolveDocumentSearchProjections', () => {
  it('returns terminal and unknown absences with current projections in request order', async () => {
    const { reader, query } = fixture();
    const active = present(1);
    const documentIds = [deletedId, active.projection.documentId, unknownId];
    const batch = {
      results: [
        { status: 'absent' as const, documentId: deletedId, version: 4 },
        active,
        { status: 'absent' as const, documentId: unknownId, version: null },
      ],
    };
    reader.resolve.mockResolvedValue(batch);

    await expect(
      query.execute({ organizationId, documentIds: documentIds.map((id) => id.toUpperCase()) }),
    ).resolves.toStrictEqual(batch);
    expect(reader.resolve).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      documentIds,
      maximumBytes,
    );
  });

  it('rejects the complete request when the reader cannot fit the batch', async () => {
    const { reader, query } = fixture();
    const documentIds = [present(1).projection.documentId, unknownId];
    reader.resolve.mockResolvedValue(null);

    await expect(query.execute({ organizationId, documentIds })).rejects.toMatchObject({
      reason: 'batch-too-large',
    });
    expect(reader.resolve).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      documentIds,
      maximumBytes,
    );
  });

  it('accepts exactly 1 MiB and rejects the entire batch once it grows by one UTF-8 byte', async () => {
    const { reader, query } = fixture();
    const prefix = Array.from({ length: 5 }, (_value, index) =>
      present(index + 1, '🚀'.repeat(45_000)),
    );
    const last = present(6, '\n');
    const used = Buffer.byteLength(JSON.stringify({ results: [...prefix, last] }), 'utf8');
    const room = maximumBytes - used;
    last.projection.body += '🚀'.repeat(Math.floor(room / 4)) + 'a'.repeat(room % 4);
    const exact = { results: [...prefix, last] };
    const oversized = {
      results: [
        ...prefix,
        { ...last, projection: { ...last.projection, body: last.projection.body + 'a' } },
      ],
    };
    const documentIds = exact.results.map(({ projection }) => projection.documentId);
    reader.resolve.mockResolvedValueOnce(exact).mockResolvedValueOnce(oversized);

    expect(Buffer.byteLength(JSON.stringify(exact), 'utf8')).toBe(maximumBytes);
    expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBe(maximumBytes + 1);
    await expect(query.execute({ organizationId, documentIds })).resolves.toStrictEqual(exact);
    await expect(query.execute({ organizationId, documentIds })).rejects.toMatchObject({
      reason: 'batch-too-large',
    });
  });

  it.each(['incomplete', 'out of order'])('rejects a reader batch that is %s', async (problem) => {
    const { reader, query } = fixture();
    const first = present(1);
    const second = present(2);
    const documentIds = [first.projection.documentId, second.projection.documentId];
    reader.resolve.mockResolvedValue({
      results: problem === 'incomplete' ? [first] : [second, first],
    });

    await expect(query.execute({ organizationId, documentIds })).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });
});

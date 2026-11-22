import { describe, expect, it, vi } from 'vitest';

import { Document } from '../../../domain/aggregates/document/document.aggregate.js';
import { CreateDocument } from '../../use-cases/commands/document/create-document/create-document.use-case.js';
import { DeleteDocument } from '../../use-cases/commands/document/delete-document/delete-document.use-case.js';
import { UpdateDocument } from '../../use-cases/commands/document/update-document/update-document.use-case.js';
import { GetDocument } from '../../use-cases/queries/document/get-document/get-document.use-case.js';
import { ListDocuments } from '../../use-cases/queries/document/list-documents/list-documents.use-case.js';
import type { DocumentCreateReceipt } from '../../models/document/document-create-receipt.model.js';
import type { DocumentCandidate } from '../../models/document/document-candidate.model.js';
import type { DocumentTransaction } from '../../models/document/document-transaction.model.js';

const caller = {
  organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f',
  actorUserId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
};
const id = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17';
const spaceId = '123e4567-e89b-42d3-a456-426614174000';
const now = new Date('2026-11-20T14:02:00Z');

function fixture() {
  let document: Document | null = null;
  let receipt: DocumentCreateReceipt | null = null;
  const store = {
    newId: vi.fn().mockResolvedValue(id),
    findAndLock: vi
      .fn<() => Promise<Document | null>>()
      .mockImplementation(() => Promise.resolve(document)),
    insert: vi.fn().mockImplementation((value: Document) => {
      document = value;
      return Promise.resolve();
    }),
    save: vi.fn().mockImplementation((value: Document) => {
      document = value;
      return Promise.resolve();
    }),
    append: vi.fn().mockResolvedValue(undefined),
    findCreateReceipt: vi.fn().mockImplementation(() => Promise.resolve(receipt)),
    saveCreateReceipt: vi.fn().mockImplementation((_user, _key, value: DocumentCreateReceipt) => {
      receipt = value;
      return Promise.resolve();
    }),
    scrubCreateReceipts: vi.fn().mockImplementation(() => {
      if (receipt !== null) receipt = { ...receipt, document: null };
      return Promise.resolve();
    }),
  } satisfies DocumentTransaction;
  const work = {
    run: <T>(_organizationId: string, fn: (tx: DocumentTransaction) => Promise<T>) => fn(store),
  };
  const reader = {
    find: vi
      .fn<() => Promise<Document | null>>()
      .mockImplementation(() => Promise.resolve(document)),
    scan: vi.fn().mockImplementation(() => {
      const snapshot = document?.snapshot;
      const items =
        snapshot?.status === 'active'
          ? [
              {
                id: snapshot.id,
                organizationId: snapshot.organizationId,
                spaceId: snapshot.spaceId,
                updatedAt: snapshot.updatedAt,
              },
            ]
          : [];
      return Promise.resolve({ items, hasMore: false });
    }),
    findMatchingSummaries: vi
      .fn()
      .mockImplementation(
        (
          _organizationId: string,
          input: { readonly candidates: readonly DocumentCandidate[]; readonly query: string },
        ) => {
          const snapshot = document?.snapshot;
          if (
            snapshot?.status !== 'active' ||
            !input.candidates.some((value) => value.id === snapshot.id)
          )
            return Promise.resolve([]);
          if (
            !snapshot.title.toLowerCase().includes(input.query) &&
            !snapshot.body.toLowerCase().includes(input.query)
          )
            return Promise.resolve([]);
          const {
            id,
            organizationId,
            spaceId,
            updatedAt,
            title,
            authorUserId,
            createdAt,
            version,
          } = snapshot;
          return Promise.resolve([
            { id, organizationId, spaceId, updatedAt, title, authorUserId, createdAt, version },
          ]);
        },
      ),
  };
  const access = {
    resolve: vi
      .fn()
      .mockImplementation((input: { readonly spaceIds: readonly string[] }) =>
        Promise.resolve(input.spaceIds.map((value) => ({ spaceId: value, role: 'edit' as const }))),
      ),
  };
  const runtime = { now: () => now };
  const cursor = { encode: vi.fn().mockReturnValue('opaque'), decode: vi.fn() };
  return { store, work, reader, access, runtime, cursor };
}

describe('document operations', () => {
  it('replays the original result without another write or event, after checking current space access', async () => {
    const f = fixture();
    const create = new CreateDocument(f.access, f.work, f.runtime);
    const request = { ...caller, spaceId, title: '  Notes  ', idempotencyKey: 'replay-key' };
    const result = await create.execute(request);
    expect(await create.execute({ ...request, title: 'Notes', body: '' })).toEqual(result);
    expect(f.access.resolve).toHaveBeenCalledTimes(2);
    expect(f.store.insert).toHaveBeenCalledOnce();
    expect(f.store.append).toHaveBeenCalledOnce();
    await expect(create.execute({ ...request, title: 'Changed' })).rejects.toMatchObject({
      reason: 'idempotency-key-reused',
    });
    f.access.resolve.mockResolvedValueOnce([]);
    await expect(create.execute(request)).rejects.toMatchObject({ reason: 'space-not-found' });
  });

  it('authorizes before revealing a version conflict and does not emit an event for an equivalent patch', async () => {
    const f = fixture();
    await new CreateDocument(f.access, f.work, f.runtime).execute({
      ...caller,
      spaceId,
      title: 'Notes',
    });
    const update = new UpdateDocument(f.reader, f.access, f.work, f.runtime);
    f.access.resolve.mockResolvedValueOnce([]);
    await expect(
      update.execute({ ...caller, documentId: id, title: 'New', expectedVersion: 99 }),
    ).rejects.toMatchObject({ reason: 'document-not-found' });
    await expect(
      update.execute({ ...caller, documentId: id, title: 'Notes', expectedVersion: 1 }),
    ).resolves.toMatchObject({ document: { version: 1 } });
    expect(f.store.save).not.toHaveBeenCalled();
    expect(f.store.append).toHaveBeenCalledOnce();
    await expect(
      update.execute({ ...caller, documentId: id, title: 'Notes', expectedVersion: 99 }),
    ).rejects.toMatchObject({ reason: 'version-mismatch', currentVersion: 1 });
  });

  it('refreshes write authority before returning a conflict on a newer document revision', async () => {
    const f = fixture();
    const created = await new CreateDocument(f.access, f.work, f.runtime).execute({
      ...caller,
      spaceId,
      title: 'Notes',
    });
    if (created.document.status !== 'active') throw new Error('Missing active fixture.');
    const newer = Document.restore({ ...created.document, title: 'Newer', version: 2 });
    f.reader.find
      .mockResolvedValueOnce(Document.restore(created.document))
      .mockResolvedValueOnce(newer);
    f.store.findAndLock.mockResolvedValue(newer);
    f.access.resolve.mockClear();
    const update = new UpdateDocument(f.reader, f.access, f.work, f.runtime);

    await expect(
      update.execute({ ...caller, documentId: id, title: 'New', expectedVersion: 1 }),
    ).rejects.toMatchObject({ reason: 'version-mismatch', currentVersion: 2 });
    expect(f.access.resolve).toHaveBeenCalledTimes(2);
    expect(f.store.save).not.toHaveBeenCalled();
  });

  it('refuses a mutation when local transaction startup outlasts the edit decision', async () => {
    const f = fixture();
    const created = await new CreateDocument(f.access, f.work, f.runtime).execute({
      ...caller,
      spaceId,
      title: 'Notes',
    });
    let elapsed = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    try {
      f.store.findAndLock.mockImplementationOnce(() => {
        elapsed = 2_001;
        return Promise.resolve(Document.restore(created.document));
      });
      const update = new UpdateDocument(f.reader, f.access, f.work, f.runtime);

      await expect(
        update.execute({ ...caller, documentId: id, title: 'New', expectedVersion: 1 }),
      ).rejects.toMatchObject({ reason: 'unavailable' });
      expect(f.store.save).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it('hides a deleted document and prevents reuse of its live creation receipt', async () => {
    const f = fixture();
    const create = new CreateDocument(f.access, f.work, f.runtime);
    const request = { ...caller, spaceId, title: 'Notes', idempotencyKey: 'same-key' };
    await create.execute(request);
    await new DeleteDocument(f.reader, f.access, f.work, f.runtime).execute({
      ...caller,
      documentId: id,
      expectedVersion: 1,
    });
    await expect(create.execute(request)).rejects.toMatchObject({ reason: 'document-not-found' });
    await expect(
      new GetDocument(f.reader, f.access).execute({ ...caller, documentId: id }),
    ).rejects.toMatchObject({ reason: 'document-not-found' });
    expect(f.store.append).toHaveBeenCalledTimes(2);
  });

  it('verifies membership for an empty page and rejects malformed authorization decisions', async () => {
    const f = fixture();
    f.access.resolve.mockResolvedValueOnce([]);
    const list = new ListDocuments(f.reader, f.access, f.cursor);
    await expect(list.execute({ ...caller, limit: 10 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(f.access.resolve).toHaveBeenCalledWith({ ...caller, spaceIds: [] });
    await new CreateDocument(f.access, f.work, f.runtime).execute({
      ...caller,
      spaceId,
      title: 'Notes',
    });
    f.access.resolve.mockResolvedValueOnce([
      { spaceId, role: 'edit' },
      { spaceId, role: 'view' },
    ]);
    await expect(list.execute({ ...caller, limit: 10 })).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('returns no continuation for a catalog containing only hidden documents', async () => {
    const f = fixture();
    await new CreateDocument(f.access, f.work, f.runtime).execute({
      ...caller,
      spaceId,
      title: 'Notes',
    });
    const candidate = { id, organizationId: caller.organizationId, spaceId, updatedAt: now };
    f.reader.scan.mockResolvedValueOnce({ items: [candidate], hasMore: false });
    f.access.resolve.mockResolvedValueOnce([]);
    await expect(
      new ListDocuments(f.reader, f.access, f.cursor).execute({
        ...caller,
        query: ' NOTES ',
        limit: 5,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(f.cursor.encode).not.toHaveBeenCalled();
    expect(f.reader.findMatchingSummaries).not.toHaveBeenCalled();
    expect(f.reader.scan).toHaveBeenCalledWith(caller.organizationId, { cursor: null, limit: 100 });
  });

  it('scans another batch after 100 hidden candidates and returns a visible match without a hidden cursor', async () => {
    const f = fixture();
    await new CreateDocument(f.access, f.work, f.runtime).execute({
      ...caller,
      spaceId,
      title: 'Notes',
    });
    const hiddenSpace = '123e4567-e89b-42d3-a456-426614174001';
    const hidden = Array.from({ length: 100 }, (_, index) => ({
      id: `019a7006-4b2c-7d4e-8f5a-${String(999999999999 - index)}`,
      organizationId: caller.organizationId,
      spaceId: hiddenSpace,
      updatedAt: new Date(now.getTime() + 1000),
    }));
    const visible = { id, organizationId: caller.organizationId, spaceId, updatedAt: now };
    f.reader.scan.mockResolvedValueOnce({ items: hidden, hasMore: true });
    f.reader.scan.mockResolvedValueOnce({ items: [visible], hasMore: false });
    f.access.resolve.mockResolvedValueOnce([]);
    f.access.resolve.mockResolvedValueOnce([{ spaceId, role: 'view' }]);
    const page = await new ListDocuments(f.reader, f.access, f.cursor).execute({
      ...caller,
      query: 'notes',
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id, title: 'Notes' });
    expect(page.nextCursor).toBeNull();
    expect(f.reader.scan).toHaveBeenCalledTimes(2);
    expect(f.reader.findMatchingSummaries).toHaveBeenCalledWith(caller.organizationId, {
      candidates: [visible],
      query: 'notes',
    });
  });

  it('fails closed when the request budget expires during a scan', async () => {
    const f = fixture();
    const canContinue = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(
      new ListDocuments(f.reader, f.access, f.cursor, canContinue).execute({
        ...caller,
        limit: 10,
      }),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.access.resolve).not.toHaveBeenCalled();
  });

  it('withholds earlier results if their space access is revoked during a later batch', async () => {
    const f = fixture();
    await new CreateDocument(f.access, f.work, f.runtime).execute({
      ...caller,
      spaceId,
      title: 'Notes',
    });
    const first = { id, organizationId: caller.organizationId, spaceId, updatedAt: now };
    const hidden = {
      ...first,
      id: '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f16',
      spaceId: '123e4567-e89b-42d3-a456-426614174001',
      updatedAt: new Date(now.getTime() - 1),
    };
    f.reader.scan.mockResolvedValueOnce({ items: [first], hasMore: true });
    f.reader.scan.mockResolvedValueOnce({ items: [hidden], hasMore: false });
    f.access.resolve.mockResolvedValueOnce([{ spaceId, role: 'view' }]);
    f.access.resolve.mockResolvedValueOnce([]);
    f.access.resolve.mockResolvedValueOnce([]);
    await expect(
      new ListDocuments(f.reader, f.access, f.cursor).execute({ ...caller, limit: 10 }),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.cursor.encode).not.toHaveBeenCalled();
  });

  it('withholds a cursor when the matching lookahead loses access', async () => {
    const f = fixture();
    const first = { id, organizationId: caller.organizationId, spaceId, updatedAt: now };
    const otherSpace = '123e4567-e89b-42d3-a456-426614174001';
    const lookahead = { ...first, id: '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f16', spaceId: otherSpace };
    const fields = { title: 'Notes', authorUserId: caller.actorUserId, createdAt: now, version: 1 };
    f.reader.scan.mockResolvedValueOnce({ items: [first, lookahead], hasMore: false });
    f.reader.findMatchingSummaries.mockResolvedValueOnce([
      { ...first, ...fields },
      { ...lookahead, ...fields },
    ]);
    f.access.resolve.mockResolvedValueOnce([
      { spaceId, role: 'view' },
      { spaceId: otherSpace, role: 'view' },
    ]);
    f.access.resolve.mockResolvedValueOnce([{ spaceId, role: 'view' }]);
    await expect(
      new ListDocuments(f.reader, f.access, f.cursor).execute({ ...caller, limit: 1 }),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.cursor.encode).not.toHaveBeenCalled();
  });

  it('rechecks 101 distinct result and lookahead spaces in batches bounded at 100', async () => {
    const f = fixture();
    const records = Array.from({ length: 101 }, (_, index) => ({
      id: `019a7005-4b2c-7d4e-8f5a-${String(999999999999 - index)}`,
      organizationId: caller.organizationId,
      spaceId: `123e4567-e89b-42d3-a456-${String(100000000000 + index)}`,
      updatedAt: now,
    }));
    f.reader.scan.mockResolvedValueOnce({ items: records.slice(0, 100), hasMore: true });
    f.reader.scan.mockResolvedValueOnce({ items: records.slice(100), hasMore: false });
    f.reader.findMatchingSummaries.mockImplementation(
      (_organizationId: string, input: { candidates: readonly DocumentCandidate[] }) =>
        Promise.resolve(
          input.candidates.map((candidate) => ({
            ...candidate,
            title: 'Notes',
            authorUserId: caller.actorUserId,
            createdAt: now,
            version: 1,
          })),
        ),
    );
    const page = await new ListDocuments(f.reader, f.access, f.cursor).execute({
      ...caller,
      limit: 100,
    });
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).toBe('opaque');
    const calls = f.access.resolve.mock.calls as unknown as [{ spaceIds: readonly string[] }][];
    expect(calls.map(([input]) => input.spaceIds.length)).toEqual([100, 1, 100, 1]);
  });

  it('creates a continuation only after a second authorized matching result', async () => {
    const f = fixture();
    const first = { id, organizationId: caller.organizationId, spaceId, updatedAt: now };
    const second = { ...first, id: '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f16' };
    const summary = {
      title: 'Notes',
      authorUserId: caller.actorUserId,
      createdAt: now,
      version: 1,
    };
    f.reader.scan.mockResolvedValueOnce({ items: [first, second], hasMore: false });
    f.reader.findMatchingSummaries.mockResolvedValueOnce([
      { ...first, ...summary },
      { ...second, ...summary },
    ]);
    const page = await new ListDocuments(f.reader, f.access, f.cursor).execute({
      ...caller,
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('opaque');
    expect(f.cursor.encode).toHaveBeenCalledWith({
      ...caller,
      query: '',
      position: { id, updatedAt: now },
    });
  });

  it('rejects a non-advancing batch rather than looping', async () => {
    const f = fixture();
    const candidate = { id, organizationId: caller.organizationId, spaceId, updatedAt: now };
    f.reader.scan.mockResolvedValue({ items: [candidate], hasMore: true });
    f.access.resolve.mockResolvedValue([]);
    await expect(
      new ListDocuments(f.reader, f.access, f.cursor).execute({ ...caller, limit: 10 }),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.reader.scan).toHaveBeenCalledTimes(2);
  });

  it('rejects the same candidate appearing again with an older timestamp', async () => {
    const f = fixture();
    const first = { id, organizationId: caller.organizationId, spaceId, updatedAt: now };
    const older = { ...first, updatedAt: new Date(now.getTime() - 1) };
    f.reader.scan.mockResolvedValueOnce({ items: [first], hasMore: true });
    f.reader.scan.mockResolvedValueOnce({ items: [older], hasMore: false });
    f.access.resolve.mockResolvedValue([]);
    await expect(
      new ListDocuments(f.reader, f.access, f.cursor).execute({ ...caller, limit: 10 }),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('applies the query only to live-authorized candidates in a mixed catalog page', async () => {
    const f = fixture();
    await new CreateDocument(f.access, f.work, f.runtime).execute({
      ...caller,
      spaceId,
      title: 'Notes',
    });
    const visible = { id, organizationId: caller.organizationId, spaceId, updatedAt: now };
    const hidden = {
      ...visible,
      id: '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f18',
      spaceId: '123e4567-e89b-42d3-a456-426614174001',
    };
    f.reader.scan.mockResolvedValueOnce({ items: [hidden, visible], hasMore: false });
    f.access.resolve.mockResolvedValueOnce([{ spaceId, role: 'view' }]);
    const page = await new ListDocuments(f.reader, f.access, f.cursor).execute({
      ...caller,
      query: 'Notes',
      limit: 5,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id, title: 'Notes' });
    expect(page.items[0]).not.toHaveProperty('body');
    expect(f.reader.findMatchingSummaries).toHaveBeenCalledWith(caller.organizationId, {
      candidates: [visible],
      query: 'notes',
    });
  });
});

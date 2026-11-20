import { describe, expect, it } from 'vitest';

import { DocumentError } from '../../errors/document/document.error.js';
import type { DocumentSnapshot } from '../../value-objects/document/document-snapshot.value-object.js';
import { Document } from './document.aggregate.js';

const id = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17';
const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const spaceId = '123e4567-e89b-42d3-a456-426614174000';
const authorUserId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const editorUserId = '123e4567-e89b-42d3-a456-426614174001';
const title = 'Notes de version 3.1';
const body =
  '# Nouveautés\r\n- [ ] Test de l’export CSV\r\n\r\n```ts\r\n  const limit = 10;\r\n```\r\n';
const createdAt = new Date('2026-11-20T14:02:00Z');
const updatedAt = new Date('2026-11-20T14:04:00Z');

function creation(
  overrides: Partial<Parameters<typeof Document.create>[0]> = {},
): Parameters<typeof Document.create>[0] {
  return { id, organizationId, spaceId, authorUserId, title, body, at: createdAt, ...overrides };
}

function edit(
  overrides: Partial<Parameters<Document['patch']>[0]> = {},
): Parameters<Document['patch']>[0] {
  return { actorUserId: editorUserId, expectedVersion: 1, at: updatedAt, ...overrides };
}

function activeSnapshot(
  overrides: Partial<Extract<DocumentSnapshot, { status: 'active' }>> = {},
): DocumentSnapshot {
  return {
    id,
    organizationId,
    spaceId,
    authorUserId,
    title,
    body,
    createdAt,
    updatedAt,
    version: 1,
    status: 'active',
    ...overrides,
  };
}

function expectRefusal(action: () => unknown, reason: DocumentError['reason']): void {
  expect(action).toThrow(DocumentError);
  expect(action).toThrow(expect.objectContaining({ reason }));
}

describe('Document lifecycle', () => {
  it('starts at version one with canonical identities, a trimmed title and original Markdown order', () => {
    const change = Document.create(
      creation({ id: id.toUpperCase(), spaceId: spaceId.toUpperCase(), title: `  ${title}\t` }),
    );
    expect(change.document.snapshot).toEqual(activeSnapshot({ updatedAt: createdAt }));
    expect(change.event).toEqual({
      kind: 'created',
      documentId: id,
      organizationId,
      spaceId,
      actorUserId: authorUserId,
      version: 1,
      occurredAt: createdAt,
    });
  });

  it('starts with empty content when the body is omitted', () => {
    expect(
      Document.create({ id, organizationId, spaceId, authorUserId, title, at: createdAt }).document
        .snapshot,
    ).toMatchObject({ body: '' });
  });

  it('preserves the author, date and version on an equivalent patch and records no fact', () => {
    const { document } = Document.create(creation());
    const change = document.patch(edit({ title: ` ${title} `, body }));
    expect(change).toEqual({ document, event: null });
    expect(document.snapshot).toEqual(activeSnapshot({ updatedAt: createdAt }));
  });

  it('changes only supplied fields and attributes a real edit without mutating the previous document', () => {
    const { document } = Document.create(creation());
    const changed = document.patch(edit({ title: '  Rapport Sprint 14  ' }));
    expect(changed.document.snapshot).toEqual(
      activeSnapshot({ title: 'Rapport Sprint 14', authorUserId: editorUserId, version: 2 }),
    );
    expect(changed.event).toEqual({
      kind: 'updated',
      documentId: id,
      organizationId,
      spaceId,
      actorUserId: editorUserId,
      version: 2,
      occurredAt: updatedAt,
    });
    expect(document.snapshot).toEqual(activeSnapshot({ updatedAt: createdAt }));
    const cleared = changed.document.patch(edit({ body: '', expectedVersion: 2 }));
    expect(cleared.document.snapshot).toMatchObject({
      body: '',
      title: 'Rapport Sprint 14',
      version: 3,
    });
  });

  it('checks the expected version before treating an edit as equivalent or removing the document', () => {
    const { document } = Document.create(creation());
    const stale = edit({ title, expectedVersion: 2 });
    expect(() => document.patch(stale)).toThrow(
      expect.objectContaining({ reason: 'version-mismatch', currentVersion: 1 }),
    );
    expect(() => document.remove(stale)).toThrow(
      expect.objectContaining({ reason: 'version-mismatch', currentVersion: 1 }),
    );
  });

  it.each([Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'reports version mismatch for out-of-range numeric preconditions',
    (expectedVersion) => {
      const { document } = Document.create(creation());
      const stale = edit({ title, expectedVersion });
      expect(() => document.patch(stale)).toThrow(
        expect.objectContaining({ reason: 'version-mismatch', currentVersion: 1 }),
      );
      expect(() => document.remove(stale)).toThrow(
        expect.objectContaining({ reason: 'version-mismatch', currentVersion: 1 }),
      );
    },
  );

  it('refuses an empty patch even when the version matches', () => {
    const { document } = Document.create(creation());
    expectRefusal(() => document.patch(edit()), 'empty-patch');
  });

  it('keeps a terminal version without document content or the previous author', () => {
    const { document } = Document.create(creation());
    const change = document.remove(edit());
    const tombstone = {
      status: 'deleted',
      id,
      organizationId,
      spaceId,
      version: 2,
      deletedAt: updatedAt,
    } as const;
    expect(change.document.snapshot).toEqual(tombstone);
    expect(change.event).toEqual({
      kind: 'deleted',
      documentId: id,
      organizationId,
      spaceId,
      actorUserId: editorUserId,
      version: 2,
      occurredAt: updatedAt,
    });
    const restored = Document.restore(tombstone);
    expectRefusal(() => restored.patch(edit({ title: 'Un nouveau titre' })), 'not-found');
    expectRefusal(() => restored.remove(edit()), 'not-found');
  });

  it('detaches the caller and snapshot Date objects from stored state', () => {
    const before = createdAt.getTime();
    const supplied = new Date(before);
    const { document, event } = Document.create(creation({ at: supplied }));
    supplied.setTime(0);
    event.occurredAt.setTime(0);
    const snapshot = document.snapshot;
    expect(snapshot.status).toBe('active');
    if (snapshot.status !== 'active') return;
    snapshot.createdAt.setTime(0);
    snapshot.updatedAt.setTime(0);
    expect(document.snapshot).toMatchObject({ createdAt, updatedAt: createdAt });
  });

  it.each(['', '\t\n  ', 'x'.repeat(201)])(
    'refuses invalid titles on create and edit (%s)',
    (invalidTitle) => {
      const { document } = Document.create(creation());
      expectRefusal(() => Document.create(creation({ title: invalidTitle })), 'invalid-title');
      expectRefusal(() => document.patch(edit({ title: invalidTitle })), 'invalid-title');
    },
  );

  it.each([
    ['ASCII', 'x'],
    ['supplementary Unicode', '\u{1F680}'],
  ])('enforces the published code point limits with %s', (_encoding, character) => {
    const longestTitle = character.repeat(200);
    const longestBody = character.repeat(100_000);
    const tooLongTitle = longestTitle + character;
    const tooLongBody = longestBody + character;
    expect(
      Document.create(creation({ title: longestTitle, body: longestBody })).document.snapshot,
    ).toMatchObject({ title: longestTitle, body: longestBody });
    const { document } = Document.create(creation());
    expect(
      document.patch(edit({ title: longestTitle, body: longestBody })).document.snapshot,
    ).toMatchObject({ title: longestTitle, body: longestBody });
    expectRefusal(() => Document.create(creation({ title: tooLongTitle })), 'invalid-title');
    expectRefusal(() => document.patch(edit({ title: tooLongTitle })), 'invalid-title');
    expectRefusal(() => Document.create(creation({ body: tooLongBody })), 'invalid-body');
    expectRefusal(() => document.patch(edit({ body: tooLongBody })), 'invalid-body');
  });

  it('preserves supplementary Unicode characters, normalization and line endings', () => {
    const original = '  A\u0301 \u{1F680}\r\n\r\n';
    const { document } = Document.create(creation({ title: 'Aéroport \u{1F680}', body: original }));
    expect(document.snapshot).toMatchObject({ title: 'Aéroport \u{1F680}', body: original });
    expect(document.patch(edit({ body: original })).event).toBeNull();
    expect(document.patch(edit({ body: original.normalize('NFC') })).event).toMatchObject({
      kind: 'updated',
    });
  });

  it.each(['\0', '\uD800', '\uDC00'])(
    'refuses text that cannot round trip through PostgreSQL',
    (invalidUnicode) => {
      const invalid = `text${invalidUnicode}text`;
      const { document } = Document.create(creation());
      expectRefusal(() => Document.create(creation({ title: invalid })), 'invalid-title');
      expectRefusal(() => Document.create(creation({ body: invalid })), 'invalid-body');
      expectRefusal(() => document.patch(edit({ title: invalid })), 'invalid-title');
      expectRefusal(() => document.patch(edit({ body: invalid })), 'invalid-body');
    },
  );

  it('requires UUIDv7 for its own ID and accepts generic UUIDs for external identities', () => {
    expect(
      Document.create(creation({ authorUserId: editorUserId.toUpperCase() })).document.snapshot,
    ).toMatchObject({ authorUserId: editorUserId, spaceId });
    expectRefusal(() => Document.create(creation({ id: spaceId })), 'invalid-state');
    expectRefusal(() => Document.create(creation({ spaceId: 'not-a-uuid' })), 'invalid-state');
    expectRefusal(
      () => Document.create(creation({ organizationId: 'not-a-uuid' })),
      'invalid-state',
    );
    expectRefusal(() => Document.create(creation({ authorUserId: 'not-a-uuid' })), 'invalid-state');
  });

  it('refuses corrupted dates and versions and cannot advance beyond the maximum safe version', () => {
    expectRefusal(() => Document.restore(activeSnapshot({ version: 0 })), 'invalid-state');
    expectRefusal(() => Document.restore(activeSnapshot({ version: 2.5 })), 'invalid-state');
    expectRefusal(
      () => Document.restore(activeSnapshot({ updatedAt: new Date(0) })),
      'invalid-state',
    );
    expectRefusal(
      () =>
        Document.restore({
          status: 'deleted',
          id,
          organizationId,
          spaceId,
          version: 1,
          deletedAt: updatedAt,
        }),
      'invalid-state',
    );
    expectRefusal(() => Document.create(creation({ at: new Date(Number.NaN) })), 'invalid-state');
    const maxVersion = Number.MAX_SAFE_INTEGER;
    const current = Document.restore(activeSnapshot({ version: maxVersion }));
    expect(current.patch(edit({ title, expectedVersion: maxVersion }))).toEqual({
      document: current,
      event: null,
    });
    expectRefusal(
      () => current.patch(edit({ title: 'Un nouveau titre', expectedVersion: maxVersion })),
      'invalid-state',
    );
    expectRefusal(() => current.remove(edit({ expectedVersion: maxVersion })), 'invalid-state');
    expectRefusal(
      () =>
        Document.restore(activeSnapshot()).patch(
          edit({ title: 'Un nouveau titre', at: createdAt }),
        ),
      'invalid-state',
    );
  });
});

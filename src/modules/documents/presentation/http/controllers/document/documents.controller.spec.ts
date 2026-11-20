import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { CreateDocument } from '../../../../application/use-cases/commands/document/create-document/create-document.use-case.js';
import type { DeleteDocument } from '../../../../application/use-cases/commands/document/delete-document/delete-document.use-case.js';
import type { UpdateDocument } from '../../../../application/use-cases/commands/document/update-document/update-document.use-case.js';
import type { GetDocument } from '../../../../application/use-cases/queries/document/get-document/get-document.use-case.js';
import type { ListDocuments } from '../../../../application/use-cases/queries/document/list-documents/list-documents.use-case.js';
import { DocumentsController } from './documents.controller.js';

const documentId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17';
const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const actorUserId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const spaceId = '123e4567-e89b-42d3-a456-426614174000';
const context = {
  organizationId,
  actor: { type: 'user' as const, id: actorUserId },
  role: 'member',
  scopes: [],
};
const document = {
  id: documentId,
  organizationId,
  spaceId,
  title: 'Notes de version 3.1',
  body: '# Nouveautés',
  authorUserId: actorUserId,
  createdAt: new Date('2026-11-07T08:00:00Z'),
  updatedAt: new Date('2026-11-09T17:20:00Z'),
  version: 3,
  status: 'active' as const,
};

function fixture() {
  const list = vi.fn().mockResolvedValue({ items: [document], nextCursor: null });
  const create = vi.fn().mockResolvedValue({ document });
  const get = vi.fn().mockResolvedValue({ document });
  const update = vi.fn().mockResolvedValue({ document });
  const remove = vi.fn().mockResolvedValue(undefined);
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  const controller = new DocumentsController(
    { execute: list } as unknown as ListDocuments,
    { execute: create } as unknown as CreateDocument,
    { execute: get } as unknown as GetDocument,
    { execute: update } as unknown as UpdateDocument,
    { execute: remove } as unknown as DeleteDocument,
  );
  return { list, create, get, update, remove, headers, response, controller };
}

describe('DocumentsController', () => {
  it('maps a creation to its private response, original location and version', async () => {
    const { controller, create, response, headers } = fixture();
    const result = await runWithOrganizationContext(context, () =>
      controller.create({ spaceId, title: document.title }, 'key-1', response),
    );
    expect(create).toHaveBeenCalledWith({
      organizationId,
      actorUserId,
      spaceId,
      title: document.title,
      idempotencyKey: 'key-1',
    });
    expect(result).toMatchObject({ id: documentId, body: document.body, version: 3 });
    expect(result).not.toHaveProperty('organizationId');
    expect(headers).toEqual({
      'Cache-Control': 'private, no-store',
      Location: `/internal/v1/documents/${documentId}`,
      ETag: '"3"',
    });
  });

  it('does not include document bodies in catalog metadata', async () => {
    const { controller, response, headers } = fixture();
    const result = await runWithOrganizationContext(context, () =>
      controller.list({ limit: 50 }, response),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('body');
    expect(result.items[0]).not.toHaveProperty('organizationId');
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  it('relays the canonical version while preserving caller and document identity', async () => {
    const { controller, update, response, headers } = fixture();
    await runWithOrganizationContext(context, () =>
      controller.update({ documentId: documentId.toUpperCase() }, { body: '' }, '"3"', response),
    );
    expect(update).toHaveBeenCalledWith({
      organizationId,
      actorUserId,
      documentId,
      body: '',
      expectedVersion: 3,
    });
    expect(headers.ETag).toBe('"3"');
  });

  it('returns the current source and version for an authorized read', async () => {
    const { controller, get, response, headers } = fixture();
    const result = await runWithOrganizationContext(context, () =>
      controller.get({ documentId }, response),
    );
    expect(get).toHaveBeenCalledWith({ organizationId, actorUserId, documentId });
    expect(result.body).toBe(document.body);
    expect(headers.ETag).toBe('"3"');
  });

  it('deletes only with the caller’s supplied strong version', async () => {
    const { controller, remove, response, headers } = fixture();
    await runWithOrganizationContext(context, () =>
      controller.delete({ documentId }, '"3"', response),
    );
    expect(remove).toHaveBeenCalledWith({
      organizationId,
      actorUserId,
      documentId,
      expectedVersion: 3,
    });
    expect(headers['Cache-Control']).toBe('private, no-store');
  });
});

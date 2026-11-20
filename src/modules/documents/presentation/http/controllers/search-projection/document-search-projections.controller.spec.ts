import { runWithOrganizationContext } from '@cadenway/nest-common';
import { describe, expect, it, vi } from 'vitest';

import { DocumentSearchProjectionError } from '../../../../application/models/search-projection/document-search-projection-error.model.js';
import type { ListDocumentSearchProjections } from '../../../../application/use-cases/queries/search-projection/list-document-search-projections/list-document-search-projections.use-case.js';
import type { ResolveDocumentSearchProjections } from '../../../../application/use-cases/queries/search-projection/resolve-document-search-projections/resolve-document-search-projections.use-case.js';
import { DocumentSearchProjectionsController } from './document-search-projections.controller.js';

const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const documentId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f17';
const absentId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f18';
const deletedId = '019a7005-4b2c-7d4e-8f5a-6b7c8d9e0f19';
const context = {
  organizationId,
  actor: { type: 'system' as const, id: 'search-service' },
  role: null,
  scopes: [],
};
const projection = {
  documentId,
  spaceId: '123e4567-e89b-42d3-a456-426614174000',
  title: 'Release notes',
  body: '# Changes\n- CSV export',
  version: 3,
};

function fixture() {
  const list = vi.fn().mockResolvedValue({
    items: [{ ...projection, organizationId }],
    nextCursor: 'next',
  });
  const resolve = vi.fn().mockResolvedValue({
    results: [
      { status: 'absent', documentId: deletedId, version: 17 },
      { status: 'present', projection },
      { status: 'absent', documentId: absentId, version: null },
    ],
  });
  const controller = new DocumentSearchProjectionsController(
    { execute: list } as unknown as ListDocumentSearchProjections,
    { execute: resolve } as unknown as ResolveDocumentSearchProjections,
  );
  return { list, resolve, controller };
}

describe('DocumentSearchProjectionsController', () => {
  it('uses the verified organization and sends only published projection fields', async () => {
    const { list, controller } = fixture();
    await expect(
      runWithOrganizationContext(context, () => controller.list({ limit: 20, cursor: 'current' })),
    ).resolves.toEqual({ items: [projection], nextCursor: 'next' });
    expect(list).toHaveBeenCalledWith({ organizationId, cursor: 'current', limit: 20 });
  });

  it('preserves result order, terminal version and unknown absence', async () => {
    const { resolve, controller } = fixture();
    const documentIds = [deletedId, documentId, absentId];
    await expect(
      runWithOrganizationContext(context, () => controller.resolve({ documentIds })),
    ).resolves.toEqual({
      results: [
        { status: 'absent', documentId: deletedId, version: 17 },
        { status: 'present', projection },
        { status: 'absent', documentId: absentId, version: null },
      ],
    });
    expect(resolve).toHaveBeenCalledWith({ organizationId, documentIds });
  });

  it.each([
    [
      { ...context, actor: { type: 'system' as const, id: 'another-service' } },
      'auth.actor-not-allowed',
    ],
    [
      { ...context, actor: { type: 'user' as const, id: 'search-service' } },
      'auth.actor-not-allowed',
    ],
    [{ ...context, organizationId: null }, 'auth.organization-required'],
  ] as const)('refuses an unauthorized projection caller before reading', async (caller, code) => {
    const { list, resolve, controller } = fixture();
    await expect(
      runWithOrganizationContext(caller, () => controller.list({ limit: 20 })),
    ).rejects.toMatchObject({ problem: { status: 403, code } });
    await expect(
      runWithOrganizationContext(caller, () => controller.resolve({ documentIds: [documentId] })),
    ).rejects.toMatchObject({ problem: { status: 403, code } });
    expect(list).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns a query issue for an invalid cursor', async () => {
    const { list, controller } = fixture();
    list.mockRejectedValueOnce(new DocumentSearchProjectionError('invalid-cursor'));
    await expect(
      runWithOrganizationContext(context, () => controller.list({ limit: 20, cursor: 'invalid' })),
    ).rejects.toMatchObject({
      problem: {
        status: 400,
        code: 'request.invalid',
        details: { issues: [{ in: 'query', path: 'cursor', code: 'invalid_cursor' }] },
      },
    });
  });

  it('refuses an oversized resolution with the contract split-and-retry code', async () => {
    const { resolve, controller } = fixture();
    resolve.mockRejectedValueOnce(new DocumentSearchProjectionError('batch-too-large'));
    await expect(
      runWithOrganizationContext(context, () => controller.resolve({ documentIds: [documentId] })),
    ).rejects.toMatchObject({
      problem: { status: 422, code: 'document.projection-batch-too-large' },
    });
  });

  it('treats malformed source data and database failures as unavailable', async () => {
    const { list, resolve, controller } = fixture();
    list.mockResolvedValueOnce({ items: [projection] });
    resolve.mockRejectedValueOnce(new Error('private query detail'));
    await expect(
      runWithOrganizationContext(context, () => controller.list({ limit: 20 })),
    ).rejects.toMatchObject({ problem: { status: 503, code: 'document.unavailable' } });
    await expect(
      runWithOrganizationContext(context, () => controller.resolve({ documentIds: [documentId] })),
    ).rejects.toMatchObject({ problem: { status: 503, code: 'document.unavailable' } });
  });
});

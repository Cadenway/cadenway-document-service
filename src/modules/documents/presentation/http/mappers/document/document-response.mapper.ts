import {
  CreateDocumentInternalResponse,
  ListDocumentsInternalResponse,
} from '@cadenway/contracts/validators/internal/document-service';
import { ProblemException } from '@cadenway/nest-common';
import type { z } from 'zod';

import type { DocumentSnapshot } from '../../../../application/models/document/document-snapshot.model.js';
import type { DocumentSummary } from '../../../../application/models/document/document-summary.model.js';

/** Exposes only a live document's public internal metadata and source. */
export function documentResponse(
  document: DocumentSnapshot,
): z.output<typeof CreateDocumentInternalResponse> {
  if (document.status !== 'active') {
    throw new ProblemException({ status: 503, code: 'document.unavailable' });
  }
  const parsed = CreateDocumentInternalResponse.safeParse({
    id: document.id,
    spaceId: document.spaceId,
    title: document.title,
    body: document.body,
    authorUserId: document.authorUserId,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    version: document.version,
  });
  if (!parsed.success) {
    throw new ProblemException({ status: 503, code: 'document.unavailable' });
  }
  return parsed.data;
}

/** Exposes a checked page without including document bodies or aggregate state. */
export function documentPage(
  items: readonly DocumentSummary[],
  nextCursor: string | null,
): z.output<typeof ListDocumentsInternalResponse> {
  const parsed = ListDocumentsInternalResponse.safeParse({
    items: items.map((item) => ({
      id: item.id,
      spaceId: item.spaceId,
      title: item.title,
      authorUserId: item.authorUserId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      version: item.version,
    })),
    nextCursor,
  });
  if (!parsed.success) {
    throw new ProblemException({ status: 503, code: 'document.unavailable' });
  }
  return parsed.data;
}

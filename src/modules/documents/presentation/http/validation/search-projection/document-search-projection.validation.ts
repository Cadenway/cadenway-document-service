import {
  ListDocumentSearchProjectionsInternalQueryParams,
  ResolveDocumentSearchProjectionsInternalBody,
  listDocumentSearchProjectionsInternalQueryLimitDefault,
} from '@cadenway/contracts/validators/internal/document-service';
import { z } from 'zod';

/** Validates the page size as a single decimal HTTP parameter before applying the contract bounds. */
export const DocumentSearchProjectionListQuery =
  ListDocumentSearchProjectionsInternalQueryParams.extend({
    limit: z
      .unknown()
      .refine(
        (limit): boolean =>
          typeof limit === 'number' || (typeof limit === 'string' && /^\d+$/u.test(limit)),
        { message: 'Expected a single decimal page limit.' },
      )
      .pipe(ListDocumentSearchProjectionsInternalQueryParams.shape.limit)
      .default(listDocumentSearchProjectionsInternalQueryLimitDefault),
  });

/** Canonicalizes requested IDs and rejects duplicates without changing the order of the batch. */
export const DocumentSearchProjectionResolveBody =
  ResolveDocumentSearchProjectionsInternalBody.transform(({ documentIds }) => ({
    documentIds: documentIds.map((id) => id.toLowerCase()),
  })).refine(({ documentIds }) => new Set(documentIds).size === documentIds.length, {
    path: ['documentIds'],
    message: 'Document IDs must be unique.',
  });

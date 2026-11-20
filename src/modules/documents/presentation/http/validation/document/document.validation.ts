import {
  CreateDocumentInternalHeader,
  ListDocumentsInternalQueryParams,
  UpdateDocumentInternalBody,
  UpdateDocumentInternalHeader,
} from '@cadenway/contracts/validators/internal/document-service';
import { ProblemException } from '@cadenway/nest-common';

/** Rejects query text that PostgreSQL cannot represent without changing its value. */
export const DocumentListQuery = ListDocumentsInternalQueryParams.refine(
  (query) => query.q === undefined || (isWellFormed(query.q) && !query.q.includes('\0')),
  { path: ['q'], message: 'Expected well-formed query text without NUL.' },
);

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** The public contract requires at least one member in a document patch. */
export const DocumentPatchBody = UpdateDocumentInternalBody.refine(
  (body) => body.title !== undefined || body.body !== undefined,
  { message: 'At least one document field is required.' },
);

/** Reads the single canonical strong ETag required by document writes. */
export function documentExpectedVersion(header: string | undefined): number {
  const parsed = UpdateDocumentInternalHeader.safeParse({ 'If-Match': header });
  if (!parsed.success) {
    throw new ProblemException({
      status: 400,
      code: 'request.invalid',
      details: {
        issues: [
          {
            in: 'header',
            path: 'If-Match',
            code: 'invalid_format',
            message: 'Expected one strong document version.',
          },
        ],
      },
    });
  }
  return Number(parsed.data['If-Match'].slice(1, -1));
}

/** Validates the optional creation key against the installed internal contract. */
export function documentIdempotencyKey(header: string | undefined): string | undefined {
  const parsed = CreateDocumentInternalHeader.safeParse({ 'Idempotency-Key': header });
  if (!parsed.success) {
    throw new ProblemException({
      status: 400,
      code: 'request.invalid',
      details: {
        issues: [
          {
            in: 'header',
            path: 'Idempotency-Key',
            code: 'invalid_format',
            message: 'Expected an idempotency key of at most 255 characters.',
          },
        ],
      },
    });
  }
  return parsed.data['Idempotency-Key'];
}

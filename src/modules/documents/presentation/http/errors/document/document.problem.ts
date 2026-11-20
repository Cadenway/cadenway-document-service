import { ProblemException } from '@cadenway/nest-common';

import { DocumentApplicationError } from '../../../../application/models/document/document-application-error.model.js';
import { DocumentError } from '../../../../application/models/document/document-error.model.js';

/** Maps application and domain refusals to the published internal Document errors. */
export async function answerDocument<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof DocumentApplicationError) {
      switch (error.reason) {
        case 'organization-not-found':
          throw new ProblemException({ status: 404, code: 'organization.not-found' });
        case 'space-not-found':
          throw new ProblemException({ status: 404, code: 'space.not-found' });
        case 'document-not-found':
          throw new ProblemException({ status: 404, code: 'document.not-found' });
        case 'role-insufficient':
          throw new ProblemException({
            status: 403,
            code: 'access.role-insufficient',
            details: { role: error.role, requiredRole: 'edit' },
          });
        case 'unavailable':
          throw new ProblemException({ status: 503, code: 'document.unavailable' });
        case 'idempotency-key-reused':
          throw new ProblemException({ status: 422, code: 'idempotency.key-reused' });
        case 'idempotency-request-in-progress':
          throw new ProblemException({ status: 409, code: 'idempotency.request-in-progress' });
        case 'invalid-cursor':
          throw new ProblemException({
            status: 400,
            code: 'request.invalid',
            details: {
              issues: [
                { in: 'query', path: 'cursor', code: 'invalid_cursor', message: 'Invalid cursor.' },
              ],
            },
          });
      }
    }
    if (error instanceof DocumentError) {
      if (error.reason === 'version-mismatch') {
        throw new ProblemException({
          status: 412,
          code: 'request.version-mismatch',
          details: { version: error.currentVersion },
        });
      }
      if (
        error.reason === 'invalid-title' ||
        error.reason === 'invalid-body' ||
        error.reason === 'empty-patch'
      ) {
        throw new ProblemException({
          status: 400,
          code: 'request.invalid',
          details: {
            issues: [
              {
                in: 'body',
                path:
                  error.reason === 'invalid-title'
                    ? 'title'
                    : error.reason === 'invalid-body'
                      ? 'body'
                      : '',
                code: 'invalid_format',
                message: 'The supplied document content is invalid.',
              },
            ],
          },
        });
      }
    }
    if (error instanceof ProblemException) throw error;
    throw new ProblemException({ status: 503, code: 'document.unavailable' });
  }
}

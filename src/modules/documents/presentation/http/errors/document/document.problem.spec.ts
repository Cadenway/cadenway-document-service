import { describe, expect, it } from 'vitest';
import { ProblemException } from '@cadenway/nest-common';

import { DocumentApplicationError } from '../../../../application/models/document/document-application-error.model.js';
import { DocumentError } from '../../../../application/models/document/document-error.model.js';
import { answerDocument } from './document.problem.js';

describe('document refusals', () => {
  it('reports the current version only for a version mismatch', async () => {
    await expect(
      answerDocument(() => Promise.reject(new DocumentError('version-mismatch', 'stale', 3))),
    ).rejects.toMatchObject({
      problem: { status: 412, code: 'request.version-mismatch', details: { version: 3 } },
    });
  });

  it('reports the live role for an authorized reader who cannot edit', async () => {
    await expect(
      answerDocument(() =>
        Promise.reject(new DocumentApplicationError('role-insufficient', 'view')),
      ),
    ).rejects.toMatchObject({
      problem: {
        status: 403,
        code: 'access.role-insufficient',
        details: { role: 'view', requiredRole: 'edit' },
      },
    });
  });

  it('does not expose rejected content in a validation problem', async () => {
    await expect(
      answerDocument(() => Promise.reject(new DocumentError('invalid-body', 'private fixture'))),
    ).rejects.toMatchObject({
      problem: {
        status: 400,
        code: 'request.invalid',
        details: { issues: [{ in: 'body', path: 'body' }] },
      },
    });
  });

  it('maps a database failure to the contract without exposing its message', async () => {
    await expect(
      answerDocument(() => Promise.reject(new Error('private query detail'))),
    ).rejects.toMatchObject({
      problem: { status: 503, code: 'document.unavailable' },
    });
  });

  it('preserves an already classified problem', async () => {
    const failure = new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    await expect(answerDocument(() => Promise.reject(failure))).rejects.toBe(failure);
  });
});

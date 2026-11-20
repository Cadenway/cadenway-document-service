import { ProblemException } from '@cadenway/nest-common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

const privateDocumentPath =
  /^\/internal\/v1\/(?:documents(?:\/[^/]+)?|document-search-projections(?:\/resolve)?)\/?$/iu;
const privateNoStore = 'private, no-store';

/** Applies document cache and URI handling after the kit parser and before Nest registers routes. */
export function configureDocumentPrivateHttp(app: Pick<NestExpressApplication, 'use'>): void {
  app.use((request: Request, response: Response, next: NextFunction): void => {
    if (!privateDocumentPath.test(request.path)) {
      next();
      return;
    }

    response.setHeader('Cache-Control', privateNoStore);
    // Express can turn a successful conditional read into a 304 even when the response is private
    // and no-store. Keep the full response on each document read and projection page.
    if (request.method === 'GET' || request.method === 'HEAD') {
      delete request.headers['if-none-match'];
      delete request.headers['if-modified-since'];
    }

    try {
      decodeURI(request.path);
    } catch {
      next(
        new ProblemException({
          status: 400,
          code: 'request.invalid',
          details: {
            issues: [
              {
                in: 'path',
                path: 'documentId',
                code: 'invalid_format',
                message: 'Expected a valid URI component.',
              },
            ],
          },
        }),
      );
      return;
    }
    next();
  });

  app.use((error: unknown, request: Request, response: Response, next: NextFunction): void => {
    if (privateDocumentPath.test(request.path)) {
      response.setHeader('Cache-Control', privateNoStore);
    }
    next(error);
  });
}

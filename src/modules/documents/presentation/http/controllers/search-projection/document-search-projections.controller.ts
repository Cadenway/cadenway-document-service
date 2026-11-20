import {
  ListDocumentSearchProjectionsInternalResponse,
  ResolveDocumentSearchProjectionsInternalResponse,
} from '@cadenway/contracts/validators/internal/document-service';
import {
  getOrganizationContext,
  InternalAccess,
  ProblemException,
  ZodValidationPipe,
} from '@cadenway/nest-common';
import { Body, Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common';
import type { z } from 'zod';

import { DocumentSearchProjectionError } from '../../../../application/models/search-projection/document-search-projection-error.model.js';
import { ListDocumentSearchProjections } from '../../../../application/use-cases/queries/search-projection/list-document-search-projections/list-document-search-projections.use-case.js';
import { ResolveDocumentSearchProjections } from '../../../../application/use-cases/queries/search-projection/resolve-document-search-projections/resolve-document-search-projections.use-case.js';
import {
  DocumentSearchProjectionListQuery,
  DocumentSearchProjectionResolveBody,
} from '../../validation/search-projection/document-search-projection.validation.js';

function searchOrganizationId(): string {
  const context = getOrganizationContext();
  if (context?.actor.type !== 'system' || context.actor.id !== 'search-service') {
    throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
  }
  if (context.organizationId === null) {
    throw new ProblemException({ status: 403, code: 'auth.organization-required' });
  }
  return context.organizationId;
}

async function answerProjection<T>(
  work: () => Promise<unknown>,
  response: z.ZodType<T>,
): Promise<T> {
  try {
    return response.parse(await work());
  } catch (error: unknown) {
    if (error instanceof DocumentSearchProjectionError) {
      if (error.reason === 'invalid-cursor') {
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
      if (error.reason === 'batch-too-large') {
        throw new ProblemException({ status: 422, code: 'document.projection-batch-too-large' });
      }
    }
    throw new ProblemException({ status: 503, code: 'document.unavailable' });
  }
}

/** Exports source projections to Search for the organization in the verified internal token. */
@Controller('internal/v1/document-search-projections')
@InternalAccess({ issuers: ['search-service'], actors: ['system'], organization: 'required' })
export class DocumentSearchProjectionsController {
  // #region Constructor
  /** Binds the page and current batch queries for the Search projection. */
  public constructor(
    private readonly listing: ListDocumentSearchProjections,
    private readonly resolving: ResolveDocumentSearchProjections,
  ) {}
  // #endregion

  // #region Methods
  /** Returns the next bounded page of active projections. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  public async list(
    @Query(new ZodValidationPipe(DocumentSearchProjectionListQuery))
    query: z.output<typeof DocumentSearchProjectionListQuery>,
  ): Promise<z.output<typeof ListDocumentSearchProjectionsInternalResponse>> {
    const organizationId = searchOrganizationId();
    return answerProjection(
      () => this.listing.execute({ organizationId, cursor: query.cursor, limit: query.limit }),
      ListDocumentSearchProjectionsInternalResponse,
    );
  }

  /** Returns a current projection or confirmed absence for each requested ID. */
  @Post('resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async resolve(
    @Body(new ZodValidationPipe(DocumentSearchProjectionResolveBody))
    body: z.output<typeof DocumentSearchProjectionResolveBody>,
  ): Promise<z.output<typeof ResolveDocumentSearchProjectionsInternalResponse>> {
    const organizationId = searchOrganizationId();
    return answerProjection(
      () => this.resolving.execute({ organizationId, documentIds: body.documentIds }),
      ResolveDocumentSearchProjectionsInternalResponse,
    );
  }
  // #endregion
}

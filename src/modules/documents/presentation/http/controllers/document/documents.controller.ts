import {
  CreateDocumentInternalBody,
  GetDocumentInternalParams,
  UpdateDocumentInternalBody,
} from '@cadenway/contracts/validators/internal/document-service';
import { formatEtag, InternalAccess, ZodValidationPipe } from '@cadenway/nest-common';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';

import { CreateDocument } from '../../../../application/use-cases/commands/document/create-document/create-document.use-case.js';
import { DeleteDocument } from '../../../../application/use-cases/commands/document/delete-document/delete-document.use-case.js';
import { UpdateDocument } from '../../../../application/use-cases/commands/document/update-document/update-document.use-case.js';
import { GetDocument } from '../../../../application/use-cases/queries/document/get-document/get-document.use-case.js';
import { ListDocuments } from '../../../../application/use-cases/queries/document/list-documents/list-documents.use-case.js';
import { answerDocument } from '../../errors/document/document.problem.js';
import { documentCaller } from '../../mappers/document/document-caller.mapper.js';
import { documentPage, documentResponse } from '../../mappers/document/document-response.mapper.js';
import {
  DocumentPatchBody,
  DocumentListQuery,
  documentExpectedVersion,
  documentIdempotencyKey,
} from '../../validation/document/document.validation.js';

/** Serves documents to the Gateway for a verified user in the selected organization. */
@Controller('internal/v1/documents')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'], organization: 'required' })
export class DocumentsController {
  // #region Constructor
  /** Binds the five document use cases. */
  public constructor(
    private readonly listing: ListDocuments,
    private readonly creating: CreateDocument,
    private readonly getting: GetDocument,
    private readonly updating: UpdateDocument,
    private readonly deleting: DeleteDocument,
  ) {}
  // #endregion

  // #region Methods
  /** Returns a fresh authorization-filtered metadata page. */
  @Get()
  public async list(
    @Query(new ZodValidationPipe(DocumentListQuery))
    query: z.output<typeof DocumentListQuery>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReturnType<typeof documentPage>> {
    const page = await answerDocument(() =>
      this.listing.execute({
        ...documentCaller(),
        query: query.q,
        cursor: query.cursor,
        limit: query.limit,
      }),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return documentPage(page.items, page.nextCursor);
  }

  /** Creates or replays the original document under current edit authority. */
  @Post()
  @HttpCode(201)
  public async create(
    @Body(new ZodValidationPipe(CreateDocumentInternalBody))
    body: z.output<typeof CreateDocumentInternalBody>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReturnType<typeof documentResponse>> {
    const result = await answerDocument(() =>
      this.creating.execute({
        ...documentCaller(),
        ...body,
        idempotencyKey: documentIdempotencyKey(idempotencyKey),
      }),
    );
    const document = documentResponse(result.document);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Location', `/internal/v1/documents/${document.id}`);
    response.setHeader('ETag', formatEtag(document.version));
    return document;
  }

  /** Returns the current document under live space authority. */
  @Get(':documentId')
  public async get(
    @Param(new ZodValidationPipe(GetDocumentInternalParams))
    path: z.output<typeof GetDocumentInternalParams>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReturnType<typeof documentResponse>> {
    const result = await answerDocument(() =>
      this.getting.execute({
        ...documentCaller(),
        documentId: path.documentId.toLowerCase(),
      }),
    );
    const document = documentResponse(result.document);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('ETag', formatEtag(document.version));
    return document;
  }

  /** Replaces supplied source fields under the current strong version. */
  @Patch(':documentId')
  public async update(
    @Param(new ZodValidationPipe(GetDocumentInternalParams))
    path: z.output<typeof GetDocumentInternalParams>,
    @Body(new ZodValidationPipe(DocumentPatchBody))
    patch: z.output<typeof UpdateDocumentInternalBody>,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReturnType<typeof documentResponse>> {
    const result = await answerDocument(() =>
      this.updating.execute({
        ...documentCaller(),
        documentId: path.documentId.toLowerCase(),
        ...patch,
        expectedVersion: documentExpectedVersion(ifMatch),
      }),
    );
    const document = documentResponse(result.document);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('ETag', formatEtag(document.version));
    return document;
  }

  /** Deletes the currently authorized document at the supplied version. */
  @Delete(':documentId')
  @HttpCode(204)
  public async delete(
    @Param(new ZodValidationPipe(GetDocumentInternalParams))
    path: z.output<typeof GetDocumentInternalParams>,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await answerDocument(() =>
      this.deleting.execute({
        ...documentCaller(),
        documentId: path.documentId.toLowerCase(),
        expectedVersion: documentExpectedVersion(ifMatch),
      }),
    );
    response.setHeader('Cache-Control', 'private, no-store');
  }
  // #endregion
}

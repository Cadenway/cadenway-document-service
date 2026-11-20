import { Module } from '@nestjs/common';

import { documentAdapters } from './composition/providers/adapters/document/document-adapters.provider.js';
import { documentUseCases } from './composition/providers/use-cases/document/document-use-cases.provider.js';
import { DocumentsController } from './presentation/http/controllers/document/documents.controller.js';

/** Binds the document operations to their tenant persistence and Task authorization. */
@Module({
  controllers: [DocumentsController],
  providers: [...documentAdapters, ...documentUseCases],
})
export class DocumentsModule {}

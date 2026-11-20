import { Module } from '@nestjs/common';

import { documentAdapters } from './composition/providers/adapters/document/document-adapters.provider.js';
import { documentUseCases } from './composition/providers/use-cases/document/document-use-cases.provider.js';
import { documentSearchProjectionProviders } from './composition/providers/use-cases/search-projection/document-search-projection.provider.js';
import { DocumentsController } from './presentation/http/controllers/document/documents.controller.js';
import { DocumentSearchProjectionsController } from './presentation/http/controllers/search-projection/document-search-projections.controller.js';

/** Binds the document operations to their tenant persistence and Task authorization. */
@Module({
  controllers: [DocumentsController, DocumentSearchProjectionsController],
  providers: [...documentAdapters, ...documentUseCases, ...documentSearchProjectionProviders],
})
export class DocumentsModule {}

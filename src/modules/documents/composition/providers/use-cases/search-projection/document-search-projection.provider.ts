import { hkdfSync } from 'node:crypto';

import { CONFIG } from '@cadenway/nest-common';
import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { Provider } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import { ListDocumentSearchProjections } from '../../../../application/use-cases/queries/search-projection/list-document-search-projections/list-document-search-projections.use-case.js';
import { ResolveDocumentSearchProjections } from '../../../../application/use-cases/queries/search-projection/resolve-document-search-projections/resolve-document-search-projections.use-case.js';
import { AesDocumentSearchProjectionCursor } from '../../../../infrastructure/adapters/crypto/aes-document-search-projection-cursor.adapter.js';
import { DrizzleDocumentSearchProjectionReader } from '../../../../infrastructure/persistence/drizzle/repositories/search-projection/drizzle-document-search-projection-reader.repository.js';

/** Selects the configured key or a stable, domain-separated key from the service signer. */
function projectionCursor(config: AppConfig): AesDocumentSearchProjectionCursor | null {
  const configured = config.SEARCH_PROJECTION_CURSOR_SECRET;
  if (configured !== undefined) {
    return new AesDocumentSearchProjectionCursor(Buffer.from(configured, 'base64url'));
  }
  const signer = config.INTERNAL_TOKEN_PRIVATE_JWK;
  if (signer === undefined) return null;
  const derived = hkdfSync(
    'sha256',
    Buffer.from(signer.d, 'base64url'),
    'cadenway-document-service',
    'document-search-projections-v1',
    32,
  );
  return new AesDocumentSearchProjectionCursor(new Uint8Array(derived));
}

/** Binds the internal Search operations and the owned tenant projection reader. */
export const documentSearchProjectionProviders: readonly Provider[] = [
  {
    provide: DrizzleDocumentSearchProjectionReader,
    inject: [TenantTransactionRunner],
    useFactory: (tenant: TenantTransactionRunner) =>
      new DrizzleDocumentSearchProjectionReader(tenant),
  },
  {
    provide: ListDocumentSearchProjections,
    inject: [DrizzleDocumentSearchProjectionReader, CONFIG],
    useFactory: (
      reader: DrizzleDocumentSearchProjectionReader,
      config: AppConfig,
    ): ListDocumentSearchProjections =>
      new ListDocumentSearchProjections(reader, projectionCursor(config)),
  },
  {
    provide: ResolveDocumentSearchProjections,
    inject: [DrizzleDocumentSearchProjectionReader],
    useFactory: (reader: DrizzleDocumentSearchProjectionReader) =>
      new ResolveDocumentSearchProjections(reader),
  },
];

import { hkdfSync, randomBytes } from 'node:crypto';

import { CONFIG, InternalHttpClient, InternalTokenSigner } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { OutboxWriter } from '@cadenway/nest-messaging/outbox';
import type { Provider } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import { DocumentApplicationError } from '../../../../application/ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentSpaceAccess } from '../../../../application/ports/outbound/authorization/document/document-space-access.port.js';
import { AesDocumentCursorAdapter } from '../../../../infrastructure/adapters/crypto/aes-document-cursor.adapter.js';
import { DocumentReceiptCleanupWorker } from '../../../../infrastructure/adapters/maintenance/document-receipt-cleanup.adapter.js';
import { TaskDocumentSpaceAccessAdapter } from '../../../../infrastructure/adapters/task-service/task-document-space-access.adapter.js';
import { DrizzleDocumentReader } from '../../../../infrastructure/persistence/drizzle/repositories/document/drizzle-document-reader.repository.js';
import { DrizzleExpiredDocumentReceipts } from '../../../../infrastructure/persistence/drizzle/repositories/document/drizzle-document-receipt-cleanup.repository.js';
import { DrizzleDocumentUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/document/drizzle-document.unit-of-work.js';
import { DOCUMENT_SPACE_ACCESS } from '../../../tokens/document/document-space-access.token.js';

const unavailableSpaceAccess: DocumentSpaceAccess = {
  resolve: () => Promise.reject(new DocumentApplicationError('unavailable')),
};

/** Instantiates the concrete adapters once per service instance. */
export const documentAdapters: readonly Provider[] = [
  {
    provide: DrizzleDocumentReader,
    inject: [TenantTransactionRunner],
    useFactory: (tenant: TenantTransactionRunner) => new DrizzleDocumentReader(tenant),
  },
  {
    provide: DrizzleDocumentUnitOfWork,
    inject: [TenantTransactionRunner, OutboxWriter],
    useFactory: (tenant: TenantTransactionRunner, outbox: OutboxWriter) =>
      new DrizzleDocumentUnitOfWork(tenant, outbox),
  },
  {
    provide: DocumentReceiptCleanupWorker,
    inject: [SystemTransactionRunner],
    useFactory: (system: SystemTransactionRunner) =>
      new DocumentReceiptCleanupWorker(new DrizzleExpiredDocumentReceipts(system)),
  },
  {
    provide: DOCUMENT_SPACE_ACCESS,
    inject: [CONFIG, { token: InternalTokenSigner, optional: true }],
    useFactory: (config: AppConfig, signer?: InternalTokenSigner): DocumentSpaceAccess => {
      if (config.DOCUMENT_ACCESS_MODE === 'search-only') return unavailableSpaceAccess;
      if (config.TASK_SERVICE_URL === undefined || signer === undefined) {
        throw new Error('The task-authorized Document API requires the Task origin and signer.');
      }
      return new TaskDocumentSpaceAccessAdapter(
        new InternalHttpClient({
          service: 'task-service',
          baseUrl: config.TASK_SERVICE_URL,
          signer,
        }),
      );
    },
  },
  {
    provide: AesDocumentCursorAdapter,
    inject: [CONFIG],
    useFactory: (config: AppConfig): AesDocumentCursorAdapter => {
      const privateKey = config.INTERNAL_TOKEN_PRIVATE_JWK;
      // Replicas with the same service key can read each other's cursors. The search-only
      // configuration issues no user cursors because Task authorization is unavailable.
      const key = privateKey
        ? new Uint8Array(
            hkdfSync(
              'sha256',
              Buffer.from(privateKey.d, 'base64url'),
              'cadenway-document-service',
              'documents-pagination-v1',
              32,
            ),
          )
        : randomBytes(32);
      return new AesDocumentCursorAdapter(key);
    },
  },
];

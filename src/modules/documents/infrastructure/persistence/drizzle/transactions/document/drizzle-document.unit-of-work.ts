import type { TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { OutboxWriter } from '@cadenway/nest-messaging/outbox';

import type { DocumentTransaction } from '../../../../../application/models/document/document-transaction.model.js';
import type { DocumentUnitOfWork } from '../../../../../application/ports/outbound/transactions/document/document-unit-of-work.port.js';
import { DrizzleDocumentTransaction } from '../../repositories/document/drizzle-document-transaction.repository.js';

/** Runs each document write and its facts on the same tenant connection. */
export class DrizzleDocumentUnitOfWork implements DocumentUnitOfWork {
  // #region Constructor
  /** Receives the kit's tenant transaction runner and outbox writer. */
  public constructor(
    private readonly tenant: TenantTransactionRunner,
    private readonly outbox: OutboxWriter,
  ) {}
  // #endregion

  // #region Methods
  /** Executes one use case in the request's selected organization. */
  public async run<T>(
    organizationId: string,
    work: (store: DocumentTransaction) => Promise<T>,
  ): Promise<T> {
    return this.tenant.run((scope) =>
      work(new DrizzleDocumentTransaction(scope, organizationId, this.outbox)),
    );
  }
  // #endregion
}

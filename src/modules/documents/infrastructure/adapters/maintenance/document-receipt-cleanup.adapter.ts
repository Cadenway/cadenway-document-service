import { Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import type { DrizzleExpiredDocumentReceipts } from '../../persistence/drizzle/repositories/document/drizzle-document-receipt-cleanup.repository.js';

const CLEANUP_INTERVAL_MS = 30_000;
const CLEANUP_BATCH_SIZE = 500;

/** Periodically removes expired create receipts without overlapping work in this process. */
export class DocumentReceiptCleanupWorker implements OnModuleInit, OnModuleDestroy {
  // #region Properties
  /** Timer and active batch are kept for an orderly shutdown. */
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private readonly logger = new Logger(DocumentReceiptCleanupWorker.name);
  // #endregion

  // #region Constructor
  /** Binds the bounded system-scoped receipt cleanup. */
  public constructor(
    private readonly receipts: Pick<DrizzleExpiredDocumentReceipts, 'purgeExpired'>,
  ) {}
  // #endregion

  // #region Methods
  /** Begins recurring cleanup when the service starts. */
  public onModuleInit(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.schedule();
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref();
    this.schedule();
  }

  /** Stops new work and waits for a currently running transaction. */
  public async onModuleDestroy(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.active;
  }

  private schedule(): void {
    if (this.active !== null) return;
    this.active = this.receipts
      .purgeExpired(CLEANUP_BATCH_SIZE)
      .then(() => undefined)
      .catch(() => {
        this.logger.warn('Expired document receipt cleanup failed.');
      })
      .finally(() => {
        this.active = null;
      });
  }
  // #endregion
}

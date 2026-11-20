import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentReceiptCleanupWorker } from './document-receipt-cleanup.adapter.js';

describe('DocumentReceiptCleanupWorker', () => {
  afterEach(() => vi.useRealTimers());

  it('does not overlap cleanup batches and waits for the active batch on shutdown', async () => {
    vi.useFakeTimers();
    let finish = (): void => undefined;
    const pending = new Promise<number>((resolve) => {
      finish = () => {
        resolve(1);
      };
    });
    const purgeExpired = vi.fn().mockReturnValue(pending);
    const worker = new DocumentReceiptCleanupWorker({ purgeExpired });
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(purgeExpired).toHaveBeenCalledOnce();
    expect(purgeExpired).toHaveBeenCalledWith(500);
    const stopped = worker.onModuleDestroy();
    finish();
    await stopped;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(purgeExpired).toHaveBeenCalledOnce();
  });

  it('retries a failed bounded batch on the next tick', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(0);
    const worker = new DocumentReceiptCleanupWorker({ purgeExpired });
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
  });
});

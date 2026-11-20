import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';

import { documentCreateReceipts } from '../../schemas/document/documents.schema.js';

/** Removes expired receipts across idle organizations using the kit's system scope. */
export class DrizzleExpiredDocumentReceipts {
  // #region Constructor
  /** Binds the system runner, whose RLS bypass is limited by the expiry predicate below. */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Removes one bounded, oldest-first page without waiting on another replica's locks. */
  public async purgeExpired(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError('Document receipt cleanup limit is invalid.');
    }
    return this.system.run(async (scope) => {
      const result = await scope.db.execute(sql`
        with expired as (
          select organization_id, actor_user_id, key_digest
          from ${documentCreateReceipts}
          where expires_at <= statement_timestamp()
          order by expires_at, organization_id, actor_user_id, key_digest
          limit ${limit} for update skip locked
        )
        delete from ${documentCreateReceipts} as receipt
        using expired
        where (receipt.organization_id, receipt.actor_user_id, receipt.key_digest)
          = (expired.organization_id, expired.actor_user_id, expired.key_digest)
          and receipt.expires_at <= statement_timestamp()
      `);
      return result.rowCount ?? 0;
    });
  }
  // #endregion
}

import type { DocumentCaller } from '../../../../models/document/document-caller.model.js';
/** A document creation under a verified caller. */
export interface CreateDocumentInput extends DocumentCaller {
  // #region Properties
  /** Contract member. */
  readonly spaceId: string;
  readonly title: string;
  readonly body?: string;
  readonly idempotencyKey?: string;
  // #endregion
}

import type { Document } from '../../../domain/aggregates/document/document.aggregate.js';
import type { DocumentFact } from '../../../domain/events/document/document-fact.event.js';
import type { DocumentCreateReceipt } from './document-create-receipt.model.js';

/** Tenant-scoped operations bound to a single write transaction. */
export interface DocumentTransaction {
  // #region Methods
  /** Contract member. */
  newId(): Promise<string>;
  find(documentId: string, lock: boolean): Promise<Document | null>;
  insert(document: Document): Promise<void>;
  save(document: Document): Promise<void>;
  append(fact: DocumentFact): Promise<void>;
  findCreateReceipt(
    actorUserId: string,
    key: string,
  ): Promise<DocumentCreateReceipt | 'in-progress' | null>;
  saveCreateReceipt(
    actorUserId: string,
    key: string,
    receipt: DocumentCreateReceipt,
  ): Promise<void>;
  scrubCreateReceipts(documentId: string): Promise<void>;
  // #endregion
}

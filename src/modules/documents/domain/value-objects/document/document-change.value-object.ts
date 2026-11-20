import type { Document } from '../../aggregates/document/document.aggregate.js';
import type { DocumentFact } from '../../events/document/document-fact.event.js';

/** Resulting aggregate and the fact to persist with it when state changes. */
export type DocumentChange<Fact extends DocumentFact | null = DocumentFact | null> = Readonly<{
  document: Document;
  event: Fact;
}>;

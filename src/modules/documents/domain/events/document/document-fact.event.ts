type DocumentFactDetails = Readonly<{
  documentId: string;
  organizationId: string;
  spaceId: string;
  actorUserId: string;
  version: number;
  occurredAt: Date;
}>;

/** A document lifecycle change mapped to the corresponding published v1 event. */
export type DocumentFact = DocumentFactDetails &
  (Readonly<{ kind: 'created' }> | Readonly<{ kind: 'updated' }> | Readonly<{ kind: 'deleted' }>);

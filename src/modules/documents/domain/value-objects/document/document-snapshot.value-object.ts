type DocumentIdentity = Readonly<{
  id: string;
  organizationId: string;
  spaceId: string;
  version: number;
}>;

/** Active document state and the durable identity of a deleted document. */
export type DocumentSnapshot = DocumentIdentity &
  (
    | Readonly<{
        status: 'active';
        title: string;
        body: string;
        authorUserId: string;
        createdAt: Date;
        updatedAt: Date;
      }>
    | Readonly<{ status: 'deleted'; deletedAt: Date }>
  );

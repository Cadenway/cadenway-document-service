/** Current text and committed version of an active document in the verified organization. */
export interface DocumentSearchProjection {
  // #region Properties
  /** Source identifiers, committed version and searchable text. */
  readonly documentId: string;
  readonly spaceId: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  // #endregion
}

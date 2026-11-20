import { DocumentApplicationError } from '../../../../models/document/document-application-error.model.js';
import type { DocumentPosition } from '../../../../models/document/document-position.model.js';
import type { DocumentSummary } from '../../../../models/document/document-summary.model.js';
import type { DocumentSpaceAccess } from '../../../../ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentCursor } from '../../../../ports/outbound/pagination/document/document-cursor.port.js';
import type { DocumentReader } from '../../../../ports/outbound/persistence/document/document-reader.port.js';
import { documentRoles } from '../../../../services/document/document-authorization.service.js';
import type { ListDocumentsInput } from './list-documents.input.js';
import type { ListDocumentsOutput } from './list-documents.output.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const documentId = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Lists only currently readable documents with a bounded scan and scoped cursor. */
export class ListDocuments {
  // #region Constructor
  /** Binds tenant reads, current authority and authenticated cursor handling. */
  public constructor(
    private readonly reader: DocumentReader,
    private readonly access: DocumentSpaceAccess,
    private readonly cursors: DocumentCursor,
    private readonly canContinue: () => boolean = () => true,
  ) {}
  // #endregion

  // #region Methods
  /** Scans bounded batches until an authorized lookahead or the real end of the catalog. */
  public async execute(input: ListDocumentsInput): Promise<ListDocumentsOutput> {
    const query = (input.query ?? '').trim().toLowerCase();
    const scope = { organizationId: input.organizationId, actorUserId: input.actorUserId, query };
    let position: DocumentPosition | null = null;
    if (input.cursor !== undefined) {
      try {
        position = this.cursors.decode({ ...scope, cursor: input.cursor });
      } catch {
        throw new DocumentApplicationError('invalid-cursor');
      }
    }
    const items: DocumentSummary[] = [];
    const seen = new Set<string>();
    let lastReturned: DocumentPosition | null = null;
    for (;;) {
      if (!this.canContinue()) throw new DocumentApplicationError('unavailable');
      const page = await this.reader.scan(input.organizationId, { cursor: position, limit: 100 });
      if (!this.canContinue()) throw new DocumentApplicationError('unavailable');
      if (page.items.length > 100 || (page.items.length === 0 && page.hasMore))
        throw new DocumentApplicationError('unavailable');
      let previous = position;
      for (const document of page.items) {
        const id = document.id.toLowerCase();
        const time = document.updatedAt.getTime();
        const priorTime = previous?.updatedAt.getTime();
        if (
          document.organizationId.toLowerCase() !== input.organizationId.toLowerCase() ||
          !documentId.test(id) ||
          !uuid.test(document.spaceId) ||
          seen.has(id) ||
          !Number.isFinite(time) ||
          (previous !== null &&
            priorTime !== undefined &&
            (time > priorTime ||
              (time === priorTime && document.id.toLowerCase() >= previous.id.toLowerCase())))
        )
          throw new DocumentApplicationError('unavailable');
        seen.add(id);
        previous = { updatedAt: document.updatedAt, id: document.id };
      }
      const roles = await documentRoles(
        this.access,
        input,
        page.items.map((document) => document.spaceId),
      );
      if (!this.canContinue()) throw new DocumentApplicationError('unavailable');
      const candidates = page.items.filter((document) => roles.has(document.spaceId.toLowerCase()));
      const summaries =
        candidates.length === 0
          ? []
          : await this.reader.findMatchingSummaries(input.organizationId, { candidates, query });
      if (!this.canContinue()) throw new DocumentApplicationError('unavailable');
      const allowed = new Map(
        candidates.map((candidate) => [candidate.id.toLowerCase(), candidate]),
      );
      const byId = new Map<string, DocumentSummary>();
      for (const summary of summaries) {
        const id = summary.id.toLowerCase();
        const candidate = allowed.get(id);
        if (
          candidate === undefined ||
          byId.has(id) ||
          summary.organizationId.toLowerCase() !== input.organizationId.toLowerCase() ||
          summary.spaceId.toLowerCase() !== candidate.spaceId.toLowerCase() ||
          summary.updatedAt.getTime() !== candidate.updatedAt.getTime()
        )
          throw new DocumentApplicationError('unavailable');
        byId.set(id, summary);
      }
      for (const document of page.items) {
        const summary = byId.get(document.id.toLowerCase());
        if (summary === undefined) continue;
        if (items.length === input.limit) {
          if (lastReturned === null) throw new DocumentApplicationError('unavailable');
          await this.requireCurrentAccess(input, [...items, summary]);
          return { items, nextCursor: this.cursors.encode({ ...scope, position: lastReturned }) };
        }
        items.push(summary);
        lastReturned = { updatedAt: document.updatedAt, id: document.id };
      }
      if (!page.hasMore) {
        await this.requireCurrentAccess(input, items);
        return { items, nextCursor: null };
      }
      position = previous;
    }
  }

  /** Rechecks every returned space and the authorized lookahead immediately before disclosure. */
  private async requireCurrentAccess(
    input: ListDocumentsInput,
    documents: readonly DocumentSummary[],
  ): Promise<void> {
    const spaces = [...new Set(documents.map((document) => document.spaceId.toLowerCase()))];
    for (let offset = 0; offset < spaces.length; offset += 100) {
      if (!this.canContinue()) throw new DocumentApplicationError('unavailable');
      const batch = spaces.slice(offset, offset + 100);
      const current = await documentRoles(this.access, input, batch);
      if (!this.canContinue() || batch.some((spaceId) => !current.has(spaceId))) {
        throw new DocumentApplicationError('unavailable');
      }
    }
  }
  // #endregion
}

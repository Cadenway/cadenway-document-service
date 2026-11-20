import {
  ResolveDocumentSpaceAccessInternalBody,
  ResolveDocumentSpaceAccessInternalResponse,
} from '@cadenway/contracts/validators/internal/task-service';
import { getOrganizationContext, ProblemException } from '@cadenway/nest-common';
import type { InternalHttpClient } from '@cadenway/nest-common';

import { DocumentApplicationError } from '../../../application/ports/outbound/authorization/document/document-space-access.port.js';
import type { DocumentSpaceAccess } from '../../../application/ports/outbound/authorization/document/document-space-access.port.js';

type SpaceLookup = Parameters<DocumentSpaceAccess['resolve']>[0];
type SpaceRoles = Awaited<ReturnType<DocumentSpaceAccess['resolve']>>;

const resolvePath = '/internal/v1/spaces/access/resolve';

/** Fetches current direct-space roles using the same verified user and organization as the caller. */
export class TaskDocumentSpaceAccessAdapter implements DocumentSpaceAccess {
  // #region Constructor
  /** Binds the shared signed Task transport. */
  public constructor(private readonly http: InternalHttpClient) {}
  // #endregion

  // #region Methods
  /** Requires a complete, uncacheable proof, including for an empty membership check. */
  public async resolve(input: SpaceLookup): Promise<SpaceRoles> {
    const context = getOrganizationContext();
    const body = ResolveDocumentSpaceAccessInternalBody.safeParse({ spaceIds: input.spaceIds });
    if (
      context?.actor.type !== 'user' ||
      context.actor.id?.toLowerCase() !== input.actorUserId.toLowerCase() ||
      context.organizationId?.toLowerCase() !== input.organizationId.toLowerCase() ||
      !body.success
    ) {
      throw new DocumentApplicationError('unavailable');
    }

    try {
      // The client signs the current context. The lookup writes nothing and can be retried safely.
      const response = await this.http.fetch(resolvePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.data),
        idempotent: true,
      });
      if (
        response.status !== 200 ||
        response.headers.get('Cache-Control')?.toLowerCase() !== 'no-store'
      ) {
        void response.body?.cancel().catch(() => undefined);
        throw new DocumentApplicationError('unavailable');
      }
      const parsed = ResolveDocumentSpaceAccessInternalResponse.safeParse(await response.json());
      if (!parsed.success) throw new DocumentApplicationError('unavailable');

      const requested = [...new Set(body.data.spaceIds.map((id) => id.toLowerCase()))];
      let previousIndex = -1;
      for (const entry of parsed.data.results) {
        const index = requested.indexOf(entry.spaceId);
        if (index <= previousIndex) throw new DocumentApplicationError('unavailable');
        previousIndex = index;
      }
      return parsed.data.results;
    } catch (error) {
      if (
        error instanceof ProblemException &&
        error.problem.status === 404 &&
        error.problem.code === 'organization.not-found'
      ) {
        throw new DocumentApplicationError('organization-not-found');
      }
      throw new DocumentApplicationError('unavailable');
    }
  }
  // #endregion
}

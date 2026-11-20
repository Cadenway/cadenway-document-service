import { DocumentApplicationError } from '../../models/document/document-application-error.model.js';
import type { DocumentCaller } from '../../models/document/document-caller.model.js';
import type { DocumentSpaceAccess } from '../../ports/outbound/authorization/document/document-space-access.port.js';

/** Validates the complete current Task proof before any result is exposed or written. */
export async function documentRoles(
  access: DocumentSpaceAccess,
  caller: DocumentCaller,
  spaceIds: readonly string[],
): Promise<ReadonlyMap<string, 'view' | 'comment' | 'edit'>> {
  const requested = [...new Set(spaceIds.map((id) => id.toLowerCase()))];
  const roles = await access.resolve({
    organizationId: caller.organizationId,
    actorUserId: caller.actorUserId,
    spaceIds: requested,
  });
  const allowed = new Map<string, 'view' | 'comment' | 'edit'>();
  for (const entry of roles) {
    const id = typeof entry.spaceId === 'string' ? entry.spaceId.toLowerCase() : '';
    if (
      !requested.includes(id) ||
      allowed.has(id) ||
      !['view', 'comment', 'edit'].includes(entry.role)
    ) {
      throw new DocumentApplicationError('unavailable');
    }
    allowed.set(id, entry.role);
  }
  return allowed;
}

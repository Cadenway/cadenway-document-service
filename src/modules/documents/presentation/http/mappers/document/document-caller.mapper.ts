import { getOrganizationContext, ProblemException } from '@cadenway/nest-common';

/** Gets the tenant and user from the verified internal-token context. */
export function documentCaller(): { organizationId: string; actorUserId: string } {
  const context = getOrganizationContext();
  if (context?.actor.type !== 'user' || context.actor.id === null) {
    throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
  }
  if (context.organizationId === null) {
    throw new ProblemException({ status: 403, code: 'auth.organization-required' });
  }
  return {
    organizationId: context.organizationId.toLowerCase(),
    actorUserId: context.actor.id.toLowerCase(),
  };
}

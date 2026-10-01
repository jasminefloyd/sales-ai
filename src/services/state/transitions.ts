export type StateEntity =
  | 'product'
  | 'audience'
  | 'opportunity'
  | 'engagement'
  | 'learning'
  | 'approval'
  | 'job';

export const stateTransitions: Record<
  StateEntity,
  Record<string, readonly string[]>
> = {
  product: {
    draft: ['analyzing', 'paused'],
    analyzing: ['audience_review', 'paused'],
    audience_review: ['active', 'paused'],
    active: ['paused'],
    paused: ['active'],
  },
  audience: {
    proposed: ['approved', 'rejected'],
    approved: ['active', 'paused', 'rejected'],
    active: ['paused'],
    paused: ['active', 'rejected'],
  },
  opportunity: {
    discovered: ['qualified', 'rejected', 'closed'],
    qualified: ['awaiting_review', 'rejected', 'closed'],
    awaiting_review: ['approved', 'rejected'],
    approved: ['engagement_pending', 'rejected', 'closed'],
    engagement_pending: ['engaged', 'rejected', 'closed'],
    engaged: ['responded', 'converted', 'closed'],
    responded: ['converted', 'closed'],
  },
  engagement: {
    drafted: ['awaiting_approval', 'rejected', 'cancelled'],
    awaiting_approval: ['approved', 'rejected', 'cancelled'],
    approved: ['queued', 'cancelled'],
    queued: ['executed', 'failed', 'cancelled'],
    failed: ['queued', 'cancelled'],
  },
  learning: {
    detected: ['proposed', 'rejected'],
    proposed: ['approved', 'rejected'],
    approved: ['active', 'rejected'],
    active: ['superseded'],
  },
  approval: {
    pending: ['approved', 'rejected', 'expired'],
    approved: ['executed'],
  },
  job: {
    queued: ['running', 'cancelled'],
    running: ['paused_budget', 'waiting_approval', 'completed', 'failed', 'cancelled'],
    paused_budget: ['queued', 'cancelled'],
    waiting_approval: ['queued', 'cancelled'],
    failed: ['queued', 'cancelled'],
  },
};

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly entity: StateEntity,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export function assertValidStateTransition(
  entity: StateEntity,
  from: string,
  to: string,
): void {
  if (from === to) return;
  if (!stateTransitions[entity][from]?.includes(to)) {
    throw new InvalidStateTransitionError(entity, from, to);
  }
}

export function getAllowedTransitions(
  entity: StateEntity,
  from: string,
): readonly string[] {
  return stateTransitions[entity][from] ?? [];
}

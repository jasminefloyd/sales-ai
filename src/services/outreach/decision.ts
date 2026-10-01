export type OutreachDecisionChannel =
  'email' | 'reddit' | 'community' | 'professional_social';

export type OutreachDecisionInput = {
  motion: string | null | undefined;
  buyerType: string;
  routeType?: string | null;
  audienceProblem: string;
  collateralType?: string | null;
  rationale?: string | null;
  cta?: string | null;
};

export function normalizeOutreachMotion(
  motion: string | null | undefined,
  buyerType: string,
) {
  const value = String(motion ?? '').toLowerCase();
  if (['b2b', 'b2c', 'b2b2c', 'community'].includes(value)) return value;
  return buyerType === 'organization' ? 'b2b' : 'b2c';
}

export function channelForOutreachDecision(
  input: OutreachDecisionInput,
): OutreachDecisionChannel {
  if (input.routeType === 'direct') return 'email';
  const motion = normalizeOutreachMotion(input.motion, input.buyerType);
  if (motion === 'b2b') return 'professional_social';
  if (motion === 'community') return 'community';
  return 'reddit';
}

export function buildOutreachDecision(input: OutreachDecisionInput) {
  const motion = normalizeOutreachMotion(input.motion, input.buyerType);
  const channel = channelForOutreachDecision(input);
  return {
    channel,
    outreach_motion: motion,
    objective: input.audienceProblem,
    rationale: input.rationale ?? `Derived from the ${motion} audience strategy.`,
    collateral_type: input.collateralType ?? 'audience-specific outreach copy',
    cta: input.cta ?? null,
    strategy: { determinedFrom: 'approved_icp_audience', channel, motion },
  };
}

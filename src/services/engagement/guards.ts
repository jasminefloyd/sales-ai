import { isSuppressed } from '../contacts/suppression';

export type PreSendInput = {
  productStatus: string;
  opportunityStatus: string;
  engagementStatus: string;
  contactEmail: string | null;
  emailVerificationStatus: string;
  suppressionRecords: Array<{
    tenant_id: string;
    product_id: string;
    channel: string;
    identifier: string;
    active: boolean;
  }>;
  productId: string;
  priorEngagements: Array<{ status: string; channel: string }>;
  sendingLimitReached: boolean;
  budgetAllowed: boolean;
  gmailEnabled: boolean;
};

export type PreSendDecision = { allowed: boolean; reason: string | null };

export function evaluatePreSend(input: PreSendInput): PreSendDecision {
  const checks: Array<[boolean, string]> = [
    [input.productStatus === 'active', 'product_not_active'],
    [input.opportunityStatus === 'approved', 'opportunity_not_approved'],
    [input.engagementStatus === 'approved', 'engagement_not_approved'],
    [Boolean(input.contactEmail), 'contact_email_missing'],
    [input.emailVerificationStatus === 'valid', 'email_not_verified'],
    [
      !isSuppressed(
        input.suppressionRecords,
        input.productId,
        'email',
        input.contactEmail ?? '',
      ),
      'contact_suppressed',
    ],
    [
      !input.priorEngagements.some(
        (engagement) =>
          engagement.channel === 'email' && engagement.status !== 'cancelled',
      ),
      'duplicate_email_engagement',
    ],
    [!input.sendingLimitReached, 'sending_limit_reached'],
    [input.budgetAllowed, 'budget_blocked'],
    [input.gmailEnabled, 'gmail_not_enabled'],
  ];
  const failed = checks.find(([passed]) => !passed);
  return { allowed: !failed, reason: failed?.[1] ?? null };
}

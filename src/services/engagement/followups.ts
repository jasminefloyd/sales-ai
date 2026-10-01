export type FollowUpEligibility = {
  explicitApproval: boolean;
  priorEngagementStatus: string;
  conversationStatus: 'open' | 'waiting' | 'closed';
  replyDetected: boolean;
  suppressed: boolean;
};

export function canScheduleFollowUp(input: FollowUpEligibility): {
  allowed: boolean;
  reason: string | null;
} {
  const checks: Array<[boolean, string]> = [
    [input.explicitApproval, 'explicit_approval_required'],
    [input.priorEngagementStatus === 'executed', 'prior_engagement_not_executed'],
    [input.conversationStatus !== 'closed', 'conversation_closed'],
    [!input.replyDetected, 'reply_detected'],
    [!input.suppressed, 'contact_suppressed'],
  ];
  const failed = checks.find(([passed]) => !passed);
  return { allowed: !failed, reason: failed?.[1] ?? null };
}

export function buildFollowUpInsert(input: {
  tenantId: 'sales_os';
  productId: string;
  opportunityId: string;
  contactId?: string;
  content: string;
  scheduledFor: string;
  actor: string;
}) {
  return {
    tenant_id: input.tenantId,
    product_id: input.productId,
    opportunity_id: input.opportunityId,
    contact_id: input.contactId ?? null,
    channel: 'email',
    action_type: 'follow_up',
    draft_content: input.content,
    final_content: null,
    status: 'drafted',
    scheduled_for: input.scheduledFor,
    created_by: input.actor,
    updated_by: input.actor,
    state_changed_by: input.actor,
  };
}

export function shouldCancelFollowUp(input: {
  replyDetected: boolean;
  suppressed: boolean;
  conversationClosed: boolean;
}): boolean {
  return input.replyDetected || input.suppressed || input.conversationClosed;
}

export async function scheduleApprovedFollowUp(
  client: SupabaseClient,
  input: {
    productId: string;
    opportunityId: string;
    contactId?: string;
    content: string;
    scheduledFor: string;
    actor: string;
    eligibility: FollowUpEligibility;
  },
) {
  const decision = canScheduleFollowUp(input.eligibility);
  if (!decision.allowed) return { status: 'blocked' as const, decision };
  const { data, error } = await client
    .from('sales_os_engagements')
    .insert(buildFollowUpInsert({ tenantId: 'sales_os', ...input }))
    .select()
    .single();
  if (error) throw error;
  return { status: 'scheduled' as const, data };
}

export async function cancelPendingFollowUps(
  client: SupabaseClient,
  input: { productId: string; opportunityId: string; actor: string; reason: string },
) {
  const { data, error } = await client
    .from('sales_os_engagements')
    .update({
      status: 'cancelled',
      failure_reason: input.reason,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('opportunity_id', input.opportunityId)
    .eq('action_type', 'follow_up')
    .in('status', ['drafted', 'awaiting_approval', 'approved', 'queued'])
    .select();
  if (error) throw error;
  return data;
}
import type { SupabaseClient } from '@supabase/supabase-js';

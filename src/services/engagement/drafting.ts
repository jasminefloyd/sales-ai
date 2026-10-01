import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';
import { validateEngagementDraft, type EngagementDraft } from './schemas';

export async function generateEngagementDraft(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    opportunityId: string;
    jobId?: string;
    actor: string;
    estimatedCost: number;
    productProfile: Record<string, unknown>;
    audience: Record<string, unknown>;
    opportunity: Record<string, unknown>;
    account?: Record<string, unknown>;
    contact?: Record<string, unknown>;
    priorInteractions?: unknown[];
    approvedLearnings?: unknown[];
  },
) {
  const context: ProviderExecutionContext = {
    productId: input.productId,
    jobId: input.jobId,
    estimatedCost: input.estimatedCost,
    actor: input.actor,
    requestReference: `engagement-draft:${input.opportunityId}`,
  };
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'reasoning',
    {
      task: 'generate_engagement_draft',
      productProfile: input.productProfile,
      audience: input.audience,
      opportunityEvidence: input.opportunity,
      account: input.account ?? null,
      contact: input.contact ?? null,
      priorInteractions: input.priorInteractions ?? [],
      approvedLearnings: input.approvedLearnings ?? [],
      outputSchema: { messageAngle: 'string', cta: 'string', draftContent: 'string' },
    },
    context,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  return { ...result, draft: validateEngagementDraft(result.result.data) };
}

export function buildEngagementInsert(input: {
  productId: string;
  opportunityId: string;
  contactId?: string;
  draft: EngagementDraft;
  providerId?: string;
  actor: string;
}) {
  return {
    tenant_id: 'sales_os',
    product_id: input.productId,
    opportunity_id: input.opportunityId,
    contact_id: input.contactId ?? null,
    channel: 'email',
    action_type: 'send',
    message_angle: input.draft.messageAngle,
    cta: input.draft.cta,
    draft_content: input.draft.draftContent,
    final_content: null,
    status: 'awaiting_approval',
    provider_id: input.providerId ?? null,
    created_by: input.actor,
    updated_by: input.actor,
    state_changed_by: input.actor,
  };
}

export async function persistEngagementDraft(
  client: SupabaseClient,
  input: Parameters<typeof buildEngagementInsert>[0],
) {
  const { data: engagement, error: engagementError } = await client
    .from('sales_os_engagements')
    .insert(buildEngagementInsert(input))
    .select()
    .single();
  if (engagementError) throw engagementError;

  const { data: approval, error: approvalError } = await client
    .from('sales_os_approvals')
    .insert({
      tenant_id: 'sales_os',
      product_id: input.productId,
      entity_type: 'engagement',
      entity_id: engagement.id,
      action_type: 'send_email',
      proposed_payload: {
        draftContent: input.draft.draftContent,
        messageAngle: input.draft.messageAngle,
        cta: input.draft.cta,
      },
      status: 'pending',
      requested_by: input.actor,
      created_by: input.actor,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .select()
    .single();
  if (approvalError) throw approvalError;
  return { engagement, approval };
}

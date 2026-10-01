import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';

export type CommunityChannelAccount = {
  id: string;
  product_id: string | null;
  platform: 'reddit' | 'community' | 'professional_social';
  external_account_id: string;
  display_label: string;
  enabled: boolean;
};

export function assertFixedCommunityIdentity(
  account: CommunityChannelAccount,
  input: { productId: string; platform: string; requestedAccountId?: string },
): void {
  if (!account.enabled) throw new Error('Configured community account is disabled.');
  if (account.product_id && account.product_id !== input.productId)
    throw new Error('Configured community account is outside the product scope.');
  if (account.platform !== input.platform)
    throw new Error('Configured community account platform does not match engagement.');
  if (
    input.requestedAccountId &&
    input.requestedAccountId !== account.external_account_id
  )
    throw new Error('Posting identity must come from fixed configuration.');
}

export function buildCommunityEngagementInsert(input: {
  productId: string;
  opportunityId: string;
  accountId: string;
  draftContent: string;
  messageAngle: string;
  cta: string;
  actor: string;
}) {
  return {
    tenant_id: 'sales_os',
    product_id: input.productId,
    opportunity_id: input.opportunityId,
    contact_id: null,
    channel: 'community',
    action_type: 'respond',
    message_angle: input.messageAngle,
    cta: input.cta,
    draft_content: input.draftContent,
    final_content: null,
    status: 'awaiting_approval',
    provider_id: null,
    created_by: input.actor,
    updated_by: input.actor,
    state_changed_by: input.actor,
    channel_account_id: input.accountId,
  };
}

export async function persistCommunityEngagement(
  client: SupabaseClient,
  input: Parameters<typeof buildCommunityEngagementInsert>[0],
) {
  const { data: engagement, error: engagementError } = await client
    .from('sales_os_engagements')
    .insert(buildCommunityEngagementInsert(input))
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
      action_type: 'publish_response',
      proposed_payload: {
        draftContent: input.draftContent,
        messageAngle: input.messageAngle,
        cta: input.cta,
        channelAccountId: input.accountId,
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

export async function publishApprovedCommunityResponse(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    opportunityId: string;
    engagementId: string;
    actor: string;
    estimatedCost: number;
    platform: 'reddit' | 'community' | 'professional_social';
    sourceUrl: string;
    parentId?: string;
    channelAccountId: string;
    requestedAccountId?: string;
    content: string;
  },
) {
  const { data: account, error: accountError } = await client
    .from('sales_os_channel_accounts')
    .select('id, product_id, platform, external_account_id, display_label, enabled')
    .eq('tenant_id', 'sales_os')
    .eq('id', input.channelAccountId)
    .maybeSingle();
  if (accountError) throw accountError;

  if (!account)
    return await markManualCommunityAction(
      client,
      input,
      'No configured branded account is available.',
    );
  assertFixedCommunityIdentity(account as CommunityChannelAccount, {
    productId: input.productId,
    platform: input.platform,
  });

  const { error: queueError } = await client
    .from('sales_os_engagements')
    .update({
      status: 'queued',
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', input.engagementId)
    .eq('status', 'approved');
  if (queueError) throw queueError;

  const context: ProviderExecutionContext = {
    productId: input.productId,
    actor: input.actor,
    estimatedCost: input.estimatedCost,
    requestReference: `publish-community:${input.engagementId}`,
  };
  let result;
  try {
    result = await executeCapabilityWithBudget(
      client,
      registry,
      recorder,
      'publishResponse',
      {
        text: input.content,
        parentId: input.parentId,
        sourceUrl: input.sourceUrl,
        configuredAccountId: account.external_account_id,
      },
      context,
    );
  } catch (error) {
    return markManualCommunityAction(
      client,
      input,
      error instanceof Error ? error.message : 'Community publishing is unavailable.',
    );
  }
  if (result.status === 'paused_budget')
    return { status: 'paused_budget' as const, result };
  if (result.status !== 'executed' || !result.result.success)
    return markManualCommunityAction(
      client,
      input,
      result.result?.error?.message ?? 'Community publishing is unavailable.',
    );

  const externalId = result.result.externalIds?.externalMessageId ?? null;
  const { data: engagement, error: updateError } = await client
    .from('sales_os_engagements')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      external_message_id: externalId,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', input.engagementId)
    .eq('status', 'queued')
    .select()
    .single();
  if (updateError) throw updateError;
  await recordCommunityEvent(client, input, 'engagement_executed', externalId, {
    channel: input.platform,
    accountId: account.id,
    sourceUrl: input.sourceUrl,
  });
  return { status: 'executed' as const, result, engagement };
}

export async function markManualCommunityAction(
  client: SupabaseClient,
  input: {
    productId: string;
    engagementId: string;
    actor: string;
    platform: 'reddit' | 'community' | 'professional_social';
    sourceUrl: string;
  },
  reason: string,
) {
  const { data: engagement, error } = await client
    .from('sales_os_engagements')
    .update({
      channel: 'manual',
      status: 'queued',
      failure_reason: `manual_action_required:${reason}`,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', input.engagementId)
    .in('status', ['approved', 'queued'])
    .select()
    .single();
  if (error) throw error;
  await recordCommunityEvent(client, input, 'manual_action_required', null, {
    channel: input.platform,
    sourceUrl: input.sourceUrl,
    reason,
  });
  return { status: 'manual' as const, engagement, reason, sourceUrl: input.sourceUrl };
}

export async function completeManualCommunityAction(
  client: SupabaseClient,
  input: {
    productId: string;
    engagementId: string;
    actor: string;
    externalMessageId?: string;
  },
) {
  const { data: engagement, error } = await client
    .from('sales_os_engagements')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      external_message_id: input.externalMessageId ?? null,
      failure_reason: null,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', input.engagementId)
    .eq('channel', 'manual')
    .eq('status', 'queued')
    .select()
    .single();
  if (error) throw error;
  await recordCommunityEvent(
    client,
    input,
    'engagement_executed',
    input.externalMessageId ?? null,
    {
      channel: 'manual',
      manuallyCompleted: true,
    },
  );
  return engagement;
}

async function recordCommunityEvent(
  client: SupabaseClient,
  input: { productId: string; engagementId: string; actor: string },
  eventType: string,
  externalEventId: string | null,
  dimensions: Record<string, unknown>,
) {
  const { error } = await client.from('sales_os_events').upsert(
    {
      tenant_id: 'sales_os',
      product_id: input.productId,
      engagement_id: input.engagementId,
      event_type: eventType,
      external_event_id: externalEventId,
      dimensions,
      idempotency_key: `${eventType}:${input.engagementId}`,
      created_by: input.actor,
    },
    { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
  );
  if (error) throw error;
}

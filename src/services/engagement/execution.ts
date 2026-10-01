import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';
import { evaluatePreSend, type PreSendInput } from './guards';

export async function executeApprovedEmail(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId?: string;
    engagementId: string;
    actor: string;
    estimatedCost: number;
    recipientEmail: string;
    subject: string;
    content: string;
    preSend: PreSendInput;
  },
) {
  const decision = evaluatePreSend(input.preSend);
  if (!decision.allowed) return { status: 'blocked' as const, decision };

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
    jobId: input.jobId,
    estimatedCost: input.estimatedCost,
    actor: input.actor,
    requestReference: `send-email:${input.engagementId}`,
  };
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'sendEmail',
    {
      to: input.recipientEmail,
      subject: input.subject,
      content: input.content,
    },
    context,
  );
  if (result.status !== 'executed' || !result.result.success) {
    await client
      .from('sales_os_engagements')
      .update({
        status: 'failed',
        failure_reason:
          result.status === 'paused_budget'
            ? 'budget_blocked'
            : (result.result?.error?.message ?? 'Email provider failed.'),
        updated_by: input.actor,
        state_changed_by: input.actor,
      })
      .eq('tenant_id', 'sales_os')
      .eq('product_id', input.productId)
      .eq('id', input.engagementId)
      .eq('status', 'queued');
    await client.from('sales_os_events').upsert(
      {
        tenant_id: 'sales_os',
        product_id: input.productId,
        engagement_id: input.engagementId,
        event_type: 'provider_failure',
        dimensions: {
          channel: 'email',
          reason:
            result.status === 'paused_budget' ? 'budget_blocked' : 'provider_failed',
        },
        idempotency_key: `provider-failure:${input.engagementId}`,
        created_by: input.actor,
      },
      { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
    );
    return { status: 'failed' as const, result };
  }

  const { data: engagement, error: engagementError } = await client
    .from('sales_os_engagements')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      external_message_id: result.result.externalIds?.messageId ?? null,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', input.engagementId)
    .eq('status', 'queued')
    .select()
    .single();
  if (engagementError) throw engagementError;
  const { data: opportunity } = await client
    .from('sales_os_opportunities')
    .select('status')
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', engagement.opportunity_id)
    .single();
  if (opportunity?.status === 'approved') {
    await client
      .from('sales_os_opportunities')
      .update({
        status: 'engagement_pending',
        updated_by: input.actor,
        state_changed_by: input.actor,
      })
      .eq('tenant_id', 'sales_os')
      .eq('product_id', input.productId)
      .eq('id', engagement.opportunity_id)
      .eq('status', 'approved');
  }
  if (
    opportunity?.status === 'approved' ||
    opportunity?.status === 'engagement_pending'
  ) {
    await client
      .from('sales_os_opportunities')
      .update({
        status: 'engaged',
        updated_by: input.actor,
        state_changed_by: input.actor,
      })
      .eq('tenant_id', 'sales_os')
      .eq('product_id', input.productId)
      .eq('id', engagement.opportunity_id)
      .eq('status', 'engagement_pending');
  }
  const messageId = result.result.externalIds?.messageId ?? null;
  const threadId = result.result.externalIds?.threadId ?? null;
  const { error: eventError } = await client.from('sales_os_events').upsert(
    {
      tenant_id: 'sales_os',
      product_id: input.productId,
      engagement_id: input.engagementId,
      event_type: 'engagement_executed',
      external_event_id: messageId,
      dimensions: { channel: 'email', threadId },
      idempotency_key: `engagement-executed:${input.engagementId}`,
      created_by: input.actor,
    },
    { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
  );
  if (eventError) throw eventError;
  return { status: 'executed' as const, result, engagement };
}

import type { SupabaseClient } from '@supabase/supabase-js';

import { appendSalesOsEvent } from './eventService';

export async function ingestInboundReply(
  client: SupabaseClient,
  input: {
    productId: string;
    externalThreadId: string;
    externalMessageId: string;
    occurredAt: string;
    excerpt?: string;
    sender?: string;
    actor: string;
  },
) {
  const { data: conversation, error: conversationError } = await client
    .from('sales_os_conversations')
    .select('id, opportunity_id, contact_id, channel, status')
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('external_thread_id', input.externalThreadId)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation)
    return { matched: false as const, reason: 'conversation_not_found' };

  const { error: conversationUpdateError } = await client
    .from('sales_os_conversations')
    .update({
      status: 'open',
      last_activity_at: input.occurredAt,
      updated_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', conversation.id);
  if (conversationUpdateError) throw conversationUpdateError;

  const { data: opportunity, error: opportunityQueryError } = await client
    .from('sales_os_opportunities')
    .select('status')
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', conversation.opportunity_id)
    .single();
  if (opportunityQueryError) throw opportunityQueryError;
  if (opportunity.status === 'engagement_pending') {
    const { error } = await client
      .from('sales_os_opportunities')
      .update({
        status: 'engaged',
        updated_by: input.actor,
        state_changed_by: input.actor,
      })
      .eq('tenant_id', 'sales_os')
      .eq('product_id', input.productId)
      .eq('id', conversation.opportunity_id)
      .eq('status', 'engagement_pending');
    if (error) throw error;
  }
  const { error: opportunityError } = await client
    .from('sales_os_opportunities')
    .update({
      status: 'responded',
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('id', conversation.opportunity_id)
    .eq('status', 'engaged');
  if (opportunityError) throw opportunityError;

  const { error: followUpError } = await client
    .from('sales_os_engagements')
    .update({
      status: 'cancelled',
      failure_reason: 'reply_received',
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('opportunity_id', conversation.opportunity_id)
    .eq('action_type', 'follow_up')
    .in('status', ['approved', 'queued']);
  if (followUpError) throw followUpError;

  const event = await appendSalesOsEvent(client, {
    productId: input.productId,
    eventType: 'response_received',
    idempotencyKey: `response-received:${input.externalMessageId}`,
    occurredAt: input.occurredAt,
    dimensions: {
      channel: conversation.channel,
      excerpt: input.excerpt ?? null,
      sender: input.sender ?? null,
    },
    opportunityId: conversation.opportunity_id,
    contactId: conversation.contact_id ?? undefined,
    externalEventId: input.externalMessageId,
    createdBy: input.actor,
  });
  return { matched: true as const, conversation, event };
}

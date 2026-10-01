import { createClient } from 'npm:@supabase/supabase-js@2';
import { enqueueLearningAnalysis } from '../_shared/learning.ts';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey)
  throw new Error('Missing Sales OS server Supabase configuration.');
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer '))
      throw new Error('Authentication required.');
    const { data: userData, error: userError } = await client.auth.getUser(
      authorization.slice(7),
    );
    if (userError || !userData.user) throw new Error('Authentication required.');
    const body = (await request.json()) as {
      productId?: string;
      externalThreadId?: string;
      externalMessageId?: string;
      occurredAt?: string;
      excerpt?: string;
      sender?: string;
    };
    if (!body.productId || !body.externalThreadId || !body.externalMessageId)
      throw new Error(
        'productId, externalThreadId, and externalMessageId are required.',
      );
    const { data: conversation, error: conversationError } = await client
      .from('sales_os_conversations')
      .select('id, opportunity_id, contact_id, channel')
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .eq('external_thread_id', body.externalThreadId)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation)
      return new Response(
        JSON.stringify({ matched: false, reason: 'conversation_not_found' }),
        {
          status: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    const occurredAt = body.occurredAt ?? new Date().toISOString();
    await client
      .from('sales_os_conversations')
      .update({
        status: 'open',
        last_activity_at: occurredAt,
        updated_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .eq('id', conversation.id);
    await client
      .from('sales_os_opportunities')
      .update({
        status: 'responded',
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .eq('id', conversation.opportunity_id)
      .eq('status', 'engaged');
    await client
      .from('sales_os_engagements')
      .update({
        status: 'cancelled',
        failure_reason: 'reply_received',
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .eq('opportunity_id', conversation.opportunity_id)
      .eq('action_type', 'follow_up')
      .in('status', ['approved', 'queued']);
    const { error: eventError } = await client.from('sales_os_events').upsert(
      {
        tenant_id: tenantId,
        product_id: body.productId,
        opportunity_id: conversation.opportunity_id,
        contact_id: conversation.contact_id,
        event_type: 'response_received',
        occurred_at: occurredAt,
        external_event_id: body.externalMessageId,
        dimensions: {
          channel: conversation.channel,
          excerpt: body.excerpt ?? null,
          sender: body.sender ?? null,
        },
        idempotency_key: `response-received:${body.externalMessageId}`,
        created_by: userData.user.id,
      },
      { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
    );
    if (eventError) throw eventError;
    await enqueueLearningAnalysis(client, body.productId, userData.user.id);
    return new Response(
      JSON.stringify({ matched: true, conversationId: conversation.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Reply ingestion failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

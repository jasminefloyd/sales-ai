import { createClient } from 'npm:@supabase/supabase-js@2';

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
      engagementId?: string;
      externalMessageId?: string;
    };
    if (!body.engagementId) throw new Error('engagementId is required.');

    const { data: engagement, error: engagementError } = await client
      .from('sales_os_engagements')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        external_message_id: body.externalMessageId ?? null,
        failure_reason: null,
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', body.engagementId)
      .in('channel', ['manual', 'reddit', 'community', 'professional_social'])
      .eq('status', 'queued')
      .select('id, product_id, channel')
      .single();
    if (engagementError) throw engagementError;

    const { error: eventError } = await client.from('sales_os_events').upsert(
      {
        tenant_id: tenantId,
        product_id: engagement.product_id,
        engagement_id: engagement.id,
        event_type: 'engagement_executed',
        external_event_id: body.externalMessageId ?? null,
        dimensions: { channel: engagement.channel, manuallyCompleted: true },
        idempotency_key: `engagement-executed:${engagement.id}`,
        created_by: userData.user.id,
      },
      { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
    );
    if (eventError) throw eventError;
    return new Response(JSON.stringify({ data: engagement }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Manual completion failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

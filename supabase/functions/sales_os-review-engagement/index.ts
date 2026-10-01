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
      action?: 'approve' | 'edit_approve' | 'reject';
      finalContent?: string;
      reviewNotes?: string;
    };
    if (!body.engagementId || !body.action)
      throw new Error('engagementId and action are required.');
    if (body.action === 'edit_approve' && !body.finalContent?.trim())
      throw new Error('finalContent is required for edit_approve.');

    const { data: engagement, error: engagementError } = await client
      .from('sales_os_engagements')
      .select('id, product_id, channel, status, draft_content')
      .eq('tenant_id', tenantId)
      .eq('id', body.engagementId)
      .single();
    if (engagementError) throw engagementError;
    if (engagement.status !== 'awaiting_approval')
      throw new Error('Engagement is not awaiting approval.');

    const nextStatus = body.action === 'reject' ? 'rejected' : 'approved';
    const { data, error } = await client
      .from('sales_os_engagements')
      .update({
        status: nextStatus,
        final_content:
          body.action === 'edit_approve' ? body.finalContent : engagement.draft_content,
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', engagement.id)
      .eq('status', 'awaiting_approval')
      .select()
      .single();
    if (error) throw error;

    const { error: approvalError } = await client
      .from('sales_os_approvals')
      .update({
        status: body.action === 'reject' ? 'rejected' : 'approved',
        reviewed_by: userData.user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: body.reviewNotes ?? null,
        proposed_payload:
          body.action === 'edit_approve' ? { finalContent: body.finalContent } : {},
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('entity_type', 'engagement')
      .eq('entity_id', engagement.id)
      .eq('status', 'pending');
    if (approvalError) throw approvalError;
    const { error: eventError } = await client.from('sales_os_events').upsert(
      {
        tenant_id: tenantId,
        product_id: engagement.product_id,
        engagement_id: engagement.id,
        event_type:
          body.action === 'reject' ? 'engagement_rejected' : 'engagement_approved',
        dimensions: { action: body.action },
        idempotency_key: `engagement-review:${engagement.id}:${body.action}`,
        created_by: userData.user.id,
      },
      { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
    );
    if (eventError) throw eventError;
    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Engagement review failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

import { createClient } from 'npm:@supabase/supabase-js@2';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Sales OS server configuration.');
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
    if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication required.');
    const { data: userData, error: userError } = await client.auth.getUser(authorization.slice(7));
    if (userError || !userData.user) throw new Error('Authentication required.');
    const body = (await request.json()) as {
      decisionId?: string;
      action?: 'approve' | 'reject' | 'pause';
    };
    if (!body.decisionId || !body.action) throw new Error('decisionId and action are required.');

    const { data: decision, error: decisionError } = await client
      .from('sales_os_outreach_decisions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', body.decisionId)
      .single();
    if (decisionError) throw decisionError;
    if (body.action === 'approve' && decision.status !== 'proposed')
      throw new Error('Only proposed outreach decisions can be approved.');

    const nextStatus = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : 'paused';
    const { data, error } = await client
      .from('sales_os_outreach_decisions')
      .update({
        status: nextStatus,
        approved_at: body.action === 'approve' ? new Date().toISOString() : null,
        approved_by: body.action === 'approve' ? userData.user.id : null,
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', body.decisionId)
      .select()
      .single();
    if (error) throw error;

    const { error: approvalError } = await client.from('sales_os_approvals').insert({
      tenant_id: tenantId,
      product_id: decision.product_id,
      entity_type: 'outreach_decision',
      entity_id: decision.id,
      action_type: body.action,
      proposed_payload: decision,
      status: nextStatus === 'approved' ? 'approved' : 'rejected',
      requested_by: userData.user.id,
      reviewed_by: userData.user.id,
      reviewed_at: new Date().toISOString(),
      state_changed_by: userData.user.id,
    });
    if (approvalError) throw approvalError;

    if (body.action === 'approve') {
      const { error: jobError } = await client.from('sales_os_jobs').upsert(
        {
          tenant_id: tenantId,
          product_id: decision.product_id,
          job_type: 'engagement_batch',
          status: 'queued',
          input: { mode: 'draft_from_decision', outreachDecisionId: decision.id },
          progress: { stage: 'queued' },
          result: {},
          estimated_cost: 0,
          max_attempts: 3,
          idempotency_key: `${tenantId}:${decision.product_id}:copy:${decision.id}:v${decision.version}`,
          created_by: userData.user.id,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      );
      if (jobError) throw jobError;
    }

    return new Response(JSON.stringify({ data, copyQueued: body.action === 'approve' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Outreach decision review failed.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

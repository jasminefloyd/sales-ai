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
const readTables: Record<string, string> = {
  get_product: 'sales_os_products',
  get_product_profile: 'sales_os_product_profiles',
  get_audiences: 'sales_os_audiences',
  search_opportunities: 'sales_os_opportunities',
  get_opportunity: 'sales_os_opportunities',
  get_engagements: 'sales_os_engagements',
  get_conversations: 'sales_os_conversations',
  get_performance: 'sales_os_events',
  get_learnings: 'sales_os_learnings',
  get_provider_performance: 'sales_os_provider_runs',
  get_job_status: 'sales_os_jobs',
};
const actionTools = new Set([
  'request_find_run',
  'request_engagement_draft',
  'request_audience_change',
  'request_opportunity_rejection',
  'request_learning_application',
]);

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
      tool?: string;
      productId?: string;
      entityId?: string;
      payload?: Record<string, unknown>;
    };
    if (!body.tool || !body.productId)
      throw new Error('tool and productId are required.');
    if (readTables[body.tool]) {
      let query = client
        .from(readTables[body.tool])
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('product_id', body.productId);
      if (body.tool === 'get_product')
        query = client
          .from(readTables[body.tool])
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('id', body.entityId ?? body.productId);
      if (body.tool === 'get_product_profile')
        query = query
          .eq('is_active', true)
          .order('version', { ascending: false })
          .limit(1);
      if (
        (body.tool === 'get_opportunity' || body.tool === 'get_product') &&
        body.entityId
      )
        query = query.eq('id', body.entityId);
      if (body.payload?.status) query = query.eq('status', String(body.payload.status));
      if (body.payload?.query && body.tool === 'search_opportunities') {
        const search = String(body.payload.query).replace(/[,().]/g, ' ');
        query = query.or(`title.ilike.%${search}%,summary.ilike.%${search}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return new Response(
        JSON.stringify({
          readOnly: true,
          tool: body.tool,
          data:
            body.tool === 'get_product' || body.tool === 'get_opportunity'
              ? (data?.[0] ?? null)
              : (data ?? []),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!actionTools.has(body.tool)) throw new Error('Unsupported console tool.');
    if (body.tool !== 'request_find_run' && body.tool !== 'request_audience_change' && !body.entityId)
      throw new Error('entityId is required for this action.');
    let entityId = body.entityId ?? null;
    let result: unknown = { pending: true };
    if (body.tool === 'request_find_run') {
      const { data: job, error: jobError } = await client
        .from('sales_os_jobs')
        .insert({
          tenant_id: tenantId,
          product_id: body.productId,
          job_type: 'find',
          status: 'waiting_approval',
          input: body.payload ?? {},
          progress: { stage: 'awaiting_console_approval' },
          result: {},
          created_by: userData.user.id,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        })
        .select()
        .single();
      if (jobError) throw jobError;
      entityId = job.id;
      result = job;
    }
    const { data: approval, error: approvalError } = await client
      .from('sales_os_approvals')
      .insert({
        tenant_id: tenantId,
        product_id: body.productId,
        entity_type: 'console_action',
        entity_id: entityId,
        action_type: body.tool,
        proposed_payload: body.payload ?? {},
        status: 'pending',
        requested_by: userData.user.id,
        created_by: userData.user.id,
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .select()
      .single();
    if (approvalError) throw approvalError;
    return new Response(
      JSON.stringify({ pendingApproval: true, tool: body.tool, approval, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Console request failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

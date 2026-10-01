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
    if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication required.');
    const { data: userData, error: userError } = await client.auth.getUser(authorization.slice(7));
    if (userError || !userData.user) throw new Error('Authentication required.');
    const body = (await request.json()) as { productId?: string; audienceId?: string; routeId?: string; query?: string };
    if (!body.productId || !body.audienceId || !body.routeId)
      throw new Error('productId, audienceId, and routeId are required.');
    const { data: route, error: routeError } = await client
      .from('sales_os_audience_routes')
      .select('id,status,audience_id')
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .eq('audience_id', body.audienceId)
      .eq('id', body.routeId)
      .single();
    if (routeError) throw routeError;
    if (!['approved', 'active'].includes(route.status)) throw new Error('Find requires an approved or active route.');
    const { data: job, error: jobError } = await client
      .from('sales_os_jobs')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: body.productId,
          job_type: 'find',
          status: 'queued',
          input: { audienceId: body.audienceId, routeId: body.routeId, query: body.query ?? null },
          progress: { stage: 'queued', discovered: 0, qualified: 0, rejected: 0 },
          result: {},
          estimated_cost: 0,
          max_attempts: 3,
          idempotency_key: `${tenantId}:${body.productId}:find:${body.routeId}`,
          created_by: userData.user.id,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      )
      .select()
      .maybeSingle();
    if (jobError) throw jobError;
    return new Response(JSON.stringify({ data: job, queued: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Find request failed.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

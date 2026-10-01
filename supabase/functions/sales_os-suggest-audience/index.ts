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
    const { data: userData, error: userError } = await client.auth.getUser(
      authorization.slice(7),
    );
    if (userError || !userData.user) throw new Error('Authentication required.');

    const body = (await request.json()) as { productId?: string; suggestion?: string };
    const productId = body.productId?.trim();
    const suggestion = body.suggestion?.trim();
    if (!productId || !suggestion) throw new Error('productId and suggestion are required.');
    if (suggestion.length > 2000)
      throw new Error('Audience suggestions must be 2,000 characters or fewer.');

    const { data: product, error: productError } = await client
      .from('sales_os_products')
      .select('id,status')
      .eq('tenant_id', tenantId)
      .eq('id', productId)
      .single();
    if (productError) throw productError;
    if (!['audience_review', 'active'].includes(product.status))
      throw new Error('Approve the Product Sales Profile before suggesting an audience.');

    const idempotencyKey = `${tenantId}:${productId}:audience_suggestion:${crypto.randomUUID()}`;
    const { data: job, error: jobError } = await client
      .from('sales_os_jobs')
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        job_type: 'audience_discovery',
        status: 'queued',
        input: { productId, suggestion, mode: 'suggested_audience' },
        progress: { stage: 'queued' },
        result: {},
        estimated_cost: 0,
        max_attempts: 3,
        idempotency_key: idempotencyKey,
        created_by: userData.user.id,
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .select('id')
      .single();
    if (jobError) throw jobError;

    return new Response(JSON.stringify({ data: { jobId: job.id, status: 'queued' } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Audience suggestion failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

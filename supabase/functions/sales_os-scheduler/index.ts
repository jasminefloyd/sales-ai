import { createClient } from 'npm:@supabase/supabase-js@2';
import { enqueueLearningAnalysis } from '../_shared/learning.ts';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
const cronSecret = Deno.env.get('SALES_OS_CRON_SECRET');
if (!supabaseUrl || !serviceRoleKey || !cronSecret)
  throw new Error('Missing Sales OS scheduler configuration.');

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sales-os-cron-secret',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (request.headers.get('x-sales-os-cron-secret') !== cronSecret)
      throw new Error('Scheduler authentication failed.');

    const { data: products, error: productError } = await client
      .from('sales_os_products')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'active');
    if (productError) throw productError;

    for (const product of products ?? [])
      await enqueueLearningAnalysis(client, product.id, 'sales_os_scheduler');

    const workerResponse = await fetch(
      supabaseUrl + '/functions/v1/sales_os-worker',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + serviceRoleKey,
          apikey: serviceRoleKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ maxJobs: 5 }),
      },
    );
    const worker = await workerResponse.json();
    if (!workerResponse.ok)
      throw new Error(worker?.error ?? 'Scheduled worker execution failed.');

    return new Response(
      JSON.stringify({ queuedLearningProducts: products?.length ?? 0, worker }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Scheduler failed.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

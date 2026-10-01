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

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication required.');
    const { data: userData, error: userError } = await client.auth.getUser(
      authorization.slice(7),
    );
    if (userError || !userData.user) throw new Error('Authentication required.');
    const body = (await request.json()) as {
      productId?: string;
      action?: 'approve' | 'reject';
      reviewNotes?: string;
    };
    if (!body.productId || !body.action)
      throw new Error('productId and action are required.');

    const { data: profile, error: profileError } = await client
      .from('sales_os_product_profiles')
      .select('id, product_id, version, review_status')
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .order('version', { ascending: false })
      .limit(1)
      .single();
    if (profileError) throw profileError;
    if (profile.review_status !== 'needs_review')
      throw new Error('The latest Product Sales Profile is not awaiting review.');

    if (body.action === 'approve') {
      const { error: deactivateError } = await client
        .from('sales_os_product_profiles')
        .update({ is_active: false, updated_by: userData.user.id })
        .eq('tenant_id', tenantId)
        .eq('product_id', body.productId)
        .eq('is_active', true);
      if (deactivateError) throw deactivateError;
    }

    const { data, error } = await client
      .from('sales_os_product_profiles')
      .update({
        review_status: body.action === 'approve' ? 'approved' : 'rejected',
        is_active: body.action === 'approve',
        approved_at: body.action === 'approve' ? new Date().toISOString() : null,
        approved_by: body.action === 'approve' ? userData.user.id : null,
        review_notes: body.reviewNotes ?? null,
        updated_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', profile.id)
      .eq('review_status', 'needs_review')
      .select()
      .single();
    if (error) throw error;

    const { error: approvalError } = await client.from('sales_os_approvals').insert({
      tenant_id: tenantId,
      product_id: body.productId,
      entity_type: 'product_profile',
      entity_id: profile.id,
      action_type: body.action,
      proposed_payload: { version: profile.version },
      status: body.action === 'approve' ? 'approved' : 'rejected',
      requested_by: userData.user.id,
      reviewed_by: userData.user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: body.reviewNotes ?? null,
      state_changed_by: userData.user.id,
    });
    if (approvalError) throw approvalError;

    if (body.action === 'approve') {
      const { error: jobError } = await client.from('sales_os_jobs').upsert(
        {
          tenant_id: tenantId,
          product_id: body.productId,
          job_type: 'audience_discovery',
          status: 'queued',
          input: { productId: body.productId, profileId: profile.id },
          progress: { stage: 'queued' },
          result: {},
          estimated_cost: 0,
          max_attempts: 3,
          idempotency_key: `${tenantId}:${body.productId}:audience_discovery:profile:${profile.id}`,
          created_by: userData.user.id,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      );
      if (jobError) throw jobError;
    }

    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: errorMessage(error, 'Profile review failed.'),
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

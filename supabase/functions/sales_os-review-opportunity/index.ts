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
      opportunityId?: string;
      action?: 'approve' | 'reject' | 'request_draft';
    };
    if (!body.opportunityId || !body.action)
      throw new Error('opportunityId and action are required.');

    const { data: opportunity, error: opportunityError } = await client
      .from('sales_os_opportunities')
      .select('id, product_id, status')
      .eq('tenant_id', tenantId)
      .eq('id', body.opportunityId)
      .single();
    if (opportunityError) throw opportunityError;

    if (body.action === 'request_draft') {
      // Requesting a draft is the user's approval to advance this opportunity
      // into the engagement workflow. The engagement worker only accepts
      // approved opportunities, so persist that transition before queueing it.
      if (opportunity.status === 'awaiting_review') {
        const { error: approvalError } = await client
          .from('sales_os_opportunities')
          .update({
            status: 'approved',
            updated_by: userData.user.id,
            state_changed_by: userData.user.id,
          })
          .eq('tenant_id', tenantId)
          .eq('id', opportunity.id)
          .eq('status', 'awaiting_review');
        if (approvalError) throw approvalError;
      } else if (!['approved', 'engagement_pending'].includes(opportunity.status)) {
        throw new Error(
          `Drafting is unavailable for an opportunity in ${opportunity.status} status.`,
        );
      }
      const { error } = await client.from('sales_os_events').upsert(
        {
          tenant_id: tenantId,
          product_id: opportunity.product_id,
          opportunity_id: opportunity.id,
          event_type: 'opportunity_draft_requested',
          dimensions: { requestedBy: userData.user.id },
          idempotency_key: `draft-request:${opportunity.id}`,
          created_by: userData.user.id,
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      );
      if (error) throw error;
      const idempotencyKey = `${tenantId}:${opportunity.product_id}:engagement_batch:${opportunity.id}`;
      const { data: existingJob, error: existingJobError } = await client
        .from('sales_os_jobs')
        .select('id,status')
        .eq('tenant_id', tenantId)
        .eq('product_id', opportunity.product_id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existingJobError) throw existingJobError;

      if (existingJob && ['failed', 'cancelled'].includes(existingJob.status)) {
        const { error: retryError } = await client
          .from('sales_os_jobs')
          .update({
            status: 'queued',
            error: null,
            result: {},
            progress: { stage: 'queued' },
            next_run_at: new Date().toISOString(),
            cancel_requested: false,
            updated_by: userData.user.id,
            state_changed_by: userData.user.id,
          })
          .eq('tenant_id', tenantId)
          .eq('id', existingJob.id)
          .in('status', ['failed', 'cancelled']);
        if (retryError) throw retryError;
      } else if (!existingJob) {
        const { error: jobError } = await client.from('sales_os_jobs').insert({
          tenant_id: tenantId,
          product_id: opportunity.product_id,
          job_type: 'engagement_batch',
          status: 'queued',
          input: { opportunityId: opportunity.id },
          progress: { stage: 'queued' },
          result: {},
          estimated_cost: 0,
          max_attempts: 3,
          idempotency_key: idempotencyKey,
          created_by: userData.user.id,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        });
        if (jobError) throw jobError;
      }
      return new Response(JSON.stringify({ data: opportunity, action: body.action }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const nextStatus = body.action === 'approve' ? 'approved' : 'rejected';
    const { data, error } = await client
      .from('sales_os_opportunities')
      .update({
        status: nextStatus,
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', opportunity.id)
      .eq('status', 'awaiting_review')
      .select()
      .single();
    if (error) throw error;
    const { error: eventError } = await client.from('sales_os_events').upsert(
      {
        tenant_id: tenantId,
        product_id: opportunity.product_id,
        opportunity_id: opportunity.id,
        event_type:
          body.action === 'approve' ? 'opportunity_approved' : 'opportunity_rejected',
        dimensions: { action: body.action },
        idempotency_key: `opportunity-review:${opportunity.id}:${body.action}`,
        created_by: userData.user.id,
      },
      { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
    );
    if (eventError) throw eventError;
    if (body.action === 'approve') {
      const { error: draftJobError } = await client.from('sales_os_jobs').upsert(
        {
          tenant_id: tenantId,
          product_id: opportunity.product_id,
          job_type: 'engagement_batch',
          status: 'queued',
          input: { opportunityId: opportunity.id },
          progress: { stage: 'queued' },
          result: {},
          estimated_cost: 0,
          max_attempts: 3,
          idempotency_key: `${tenantId}:${opportunity.product_id}:engagement_batch:${opportunity.id}`,
          created_by: userData.user.id,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      );
      if (draftJobError) throw draftJobError;
    }
    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Opportunity review failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

import { createClient } from 'npm:@supabase/supabase-js@2';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Sales OS server Supabase configuration.');
const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication required.');
    const { data: userData, error: userError } = await client.auth.getUser(authorization.slice(7));
    if (userError || !userData.user) throw new Error('Authentication required.');
    const body = (await request.json()) as { action?: 'cancel' | 'resume' | 'retry' | 'mark_stale'; jobId?: string; staleMinutes?: number };
    if (!body.action) throw new Error('action is required.');
    if (body.action === 'mark_stale') {
      const staleBefore = new Date(Date.now() - (body.staleMinutes ?? 30) * 60_000).toISOString();
      const { data, error } = await client.from('sales_os_jobs').update({ status: 'failed', error: { reason: 'stale_heartbeat' }, updated_by: userData.user.id, state_changed_by: userData.user.id }).eq('tenant_id', tenantId).eq('status', 'running').lt('last_heartbeat_at', staleBefore).select();
      if (error) throw error;
      return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!body.jobId) throw new Error('jobId is required.');
    const statusByAction = { cancel: 'cancelled', resume: 'queued', retry: 'queued' } as const;
    const allowedByAction = { cancel: ['queued', 'running', 'paused_budget', 'waiting_approval', 'failed'], resume: ['paused_budget', 'waiting_approval'], retry: ['failed'] } as const;
    const { data: current, error: currentError } = await client.from('sales_os_jobs').select('id,status,attempt,max_attempts').eq('tenant_id', tenantId).eq('id', body.jobId).single();
    if (currentError || !current || !allowedByAction[body.action].includes(current.status)) throw new Error('Job is not eligible for this action.');
    if (body.action === 'retry' && current.attempt >= current.max_attempts) throw new Error('Job has reached its retry limit.');
    const { data, error } = await client.from('sales_os_jobs').update({ status: statusByAction[body.action], cancel_requested: body.action === 'cancel', error: body.action === 'cancel' ? { reason: 'cancelled_by_operator' } : null, next_run_at: body.action === 'cancel' ? null : new Date().toISOString(), updated_by: userData.user.id, state_changed_by: userData.user.id }).eq('tenant_id', tenantId).eq('id', body.jobId).eq('status', current.status).select().single();
    if (error) throw error;
    return new Response(JSON.stringify({ data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Job control failed.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

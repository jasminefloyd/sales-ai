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
const allowedTargets = new Set([
  'audience_priority',
  'audience_status',
  'route_priority',
  'source_priority',
  'signal_weight',
  'contact_role_preference',
  'message_angle_preference',
  'cta_preference',
  'follow_up_cadence',
  'provider_priority',
  'evidence_score_rubric',
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
      learningId?: string;
      action?: 'approve' | 'reject';
    };
    if (!body.learningId || !body.action)
      throw new Error('learningId and action are required.');
    const { data: learning, error: learningError } = await client
      .from('sales_os_learnings')
      .select(
        'id, product_id, status, target_entity_id, target_entity_type, recommended_change',
      )
      .eq('tenant_id', tenantId)
      .eq('id', body.learningId)
      .single();
    if (learningError) throw learningError;
    if (!['detected', 'proposed'].includes(learning.status))
      throw new Error('Learning is not awaiting review.');
    if (body.action === 'reject') {
      const { data, error } = await client
        .from('sales_os_learnings')
        .update({
          status: 'rejected',
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('id', learning.id)
        .eq('status', learning.status)
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const change = learning.recommended_change as {
      targetKey?: string;
      targetEntityId?: string | null;
      before?: unknown;
      after?: unknown;
    };
    if (!change || !change.targetKey || !allowedTargets.has(change.targetKey))
      throw new Error('Learning target is not allowlisted.');
    if (learning.status === 'detected') {
      const { error } = await client
        .from('sales_os_learnings')
        .update({
          status: 'proposed',
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('id', learning.id)
        .eq('status', 'detected');
      if (error) throw error;
    }
    const { error: configurationError } = await client.from('sales_os_learning_configurations').upsert(
      {
        tenant_id: tenantId,
        product_id: learning.product_id,
        target_key: change.targetKey,
        target_entity_id: change.targetEntityId ?? learning.product_id,
        value: { before: change.before ?? null, after: change.after },
        source_learning_id: learning.id,
        created_by: userData.user.id,
        updated_by: userData.user.id,
      },
      { onConflict: 'tenant_id,product_id,target_key,target_entity_id' },
    );
    if (configurationError) throw configurationError;
    const { error: approvalError } = await client
      .from('sales_os_learnings')
      .update({
        status: 'approved',
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', learning.id)
      .eq('status', 'proposed');
    if (approvalError) throw approvalError;

    if (
      change.targetKey === 'audience_priority' ||
      change.targetKey === 'audience_status'
    ) {
      const field = change.targetKey === 'audience_priority' ? 'priority' : 'status';
      const { data: current, error: currentError } = await client
        .from('sales_os_audiences')
        .select(field)
        .eq('tenant_id', tenantId)
        .eq('product_id', learning.product_id)
        .eq('id', change.targetEntityId)
        .single();
      if (currentError) throw currentError;
      if (!sameValue(current[field], change.before))
        throw new Error('Learning target changed since proposal.');
      const { error } = await client
        .from('sales_os_audiences')
        .update({
          [field]: change.after,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('product_id', learning.product_id)
        .eq('id', change.targetEntityId);
      if (error) throw error;
    } else if (change.targetKey === 'signal_weight') {
      const { data: current, error: currentError } = await client
        .from('sales_os_signals')
        .select('weight')
        .eq('tenant_id', tenantId)
        .eq('product_id', learning.product_id)
        .eq('id', change.targetEntityId)
        .single();
      if (currentError) throw currentError;
      if (!sameValue(current.weight, change.before))
        throw new Error('Learning target changed since proposal.');
      const { error } = await client
        .from('sales_os_signals')
        .update({ weight: change.after, updated_by: userData.user.id })
        .eq('tenant_id', tenantId)
        .eq('product_id', learning.product_id)
        .eq('id', change.targetEntityId);
      if (error) throw error;
    } else if (change.targetKey === 'provider_priority') {
      const { data: current, error: currentError } = await client
        .from('sales_os_providers')
        .select('priority')
        .eq('tenant_id', tenantId)
        .eq('id', change.targetEntityId)
        .single();
      if (currentError) throw currentError;
      if (!sameValue(current.priority, change.before))
        throw new Error('Learning target changed since proposal.');
      const { error } = await client
        .from('sales_os_providers')
        .update({ priority: change.after, updated_by: userData.user.id })
        .eq('tenant_id', tenantId)
        .eq('id', change.targetEntityId);
      if (error) throw error;
    } else {
      const { error } = await client.from('sales_os_learning_configurations').upsert(
        {
          tenant_id: tenantId,
          product_id: learning.product_id,
          target_key: change.targetKey,
          target_entity_id: change.targetEntityId ?? learning.product_id,
          value: { before: change.before ?? null, after: change.after },
          source_learning_id: learning.id,
          created_by: userData.user.id,
          updated_by: userData.user.id,
        },
        { onConflict: 'tenant_id,product_id,target_key,target_entity_id' },
      );
      if (error) throw error;
    }
    await client
      .from('sales_os_learnings')
      .update({
        status: 'superseded',
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('product_id', learning.product_id)
      .eq('target_entity_type', change.targetKey)
      .eq('target_entity_id', change.targetEntityId ?? learning.product_id)
      .eq('status', 'active');
    const { data, error } = await client
      .from('sales_os_learnings')
      .update({
        status: 'active',
        applied_at: new Date().toISOString(),
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', learning.id)
      .eq('status', 'approved')
      .select()
      .single();
    if (error) throw error;
    await client.from('sales_os_events').upsert(
      {
        tenant_id: tenantId,
        product_id: learning.product_id,
        event_type: 'learning_applied',
        dimensions: { learningId: learning.id, targetKey: change.targetKey },
        idempotency_key: `learning-applied:${learning.id}`,
        created_by: userData.user.id,
      },
      { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
    );
    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Learning review failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

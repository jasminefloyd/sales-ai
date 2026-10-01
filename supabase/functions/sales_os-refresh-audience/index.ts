import { createClient } from 'npm:@supabase/supabase-js@2';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey)
  throw new Error('Missing Sales OS server configuration.');
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
    const { data: auth, error: authError } = await client.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !auth.user) throw new Error('Authentication required.');
    const body = (await request.json()) as {
      action?: 'preview' | 'refresh';
      productId?: string;
      definitionId?: string;
    };
    if (!body.action || !body.productId || !body.definitionId)
      throw new Error('action, productId, and definitionId are required.');
    const { data: definition, error: definitionError } = await client
      .from('sales_os_audience_definitions')
      .select('id,product_id,icp_id,audience_id,version,rule_definition,status')
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .eq('id', body.definitionId)
      .single();
    if (definitionError) throw definitionError;
    if (!['approved', 'active'].includes(definition.status))
      throw new Error('Only approved or active definitions can be refreshed.');
    const { data: members, error: memberError } = await client
      .from('sales_os_audience_members')
      .select(
        'id,status,suppression_state,consent_state,identity_type,external_entity_key,account_id,contact_id',
      )
      .eq('tenant_id', tenantId)
      .eq('definition_id', definition.id);
    if (memberError) throw memberError;
    const results = (members ?? []).map((member) => ({
      id: member.id,
      matches: evaluateRule(
        definition.rule_definition as Record<string, unknown>,
        member as Record<string, unknown>,
      ),
      status: member.status,
      suppressionState: member.suppression_state,
      consentState: member.consent_state,
    }));
    const preview = {
      definitionId: definition.id,
      version: definition.version,
      total: results.length,
      matching: results.filter((item) => item.matches).length,
      wouldRemove: results.filter((item) => !item.matches).length,
      results,
    };
    if (body.action === 'preview') return json({ preview });
    const { data: job, error: jobError } = await client
      .from('sales_os_jobs')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: definition.product_id,
          job_type: 'audience_refresh',
          workflow_stage: 'audience',
          status: 'queued',
          input: {
            audienceId: definition.audience_id,
            definitionId: definition.id,
            mode: 'refresh',
          },
          progress: { stage: 'queued' },
          result: {},
          estimated_cost: 0,
          max_attempts: 3,
          idempotency_key: `${tenantId}:${definition.product_id}:audience_refresh:${definition.id}:${definition.version}`,
          created_by: auth.user.id,
          updated_by: auth.user.id,
          state_changed_by: auth.user.id,
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle();
    if (jobError) throw jobError;
    return json({ queued: true, jobId: job?.id ?? null, preview });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Audience refresh failed.' },
      400,
    );
  }
});

function evaluateRule(rule: Record<string, unknown>, entity: Record<string, unknown>) {
  const conditions = (rule.conditions ?? rule.filters ?? {}) as Record<string, unknown>;
  const evaluate = (condition: unknown): boolean => {
    if (!condition || typeof condition !== 'object') return true;
    if (Array.isArray(condition)) return condition.every(evaluate);
    const item = condition as Record<string, unknown>;
    const field = String(item.field ?? '');
    const actual = field ? entity[field] : undefined;
    const operator = String(item.operator ?? 'exists');
    const expected = item.value;
    if (operator === 'exists')
      return actual !== null && actual !== undefined && String(actual).trim() !== '';
    if (operator === 'equals')
      return (
        String(actual ?? '').toLowerCase() === String(expected ?? '').toLowerCase()
      );
    if (operator === 'contains')
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase());
    if (operator === 'in')
      return Array.isArray(expected) && expected.map(String).includes(String(actual));
    return false;
  };
  const all = conditions.all ?? rule.all ?? [];
  const any = conditions.any ?? rule.any;
  const exclude = conditions.exclude ?? rule.exclude ?? [];
  const excluded = Array.isArray(exclude) ? exclude.some(evaluate) : evaluate(exclude);
  return (
    evaluate(all) &&
    (any === undefined || (Array.isArray(any) && any.some(evaluate))) &&
    !excluded
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

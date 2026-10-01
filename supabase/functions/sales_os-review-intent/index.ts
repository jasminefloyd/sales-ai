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
      scoreId?: string;
      action?: 'override' | 'clear_override';
      score?: number;
      reason?: string;
    };
    if (!body.scoreId || !body.action)
      throw new Error('scoreId and action are required.');
    const { data: current, error: readError } = await client
      .from('sales_os_intent_scores')
      .select('id,product_id,audience_id,signal_id,raw_score,score')
      .eq('tenant_id', tenantId)
      .eq('id', body.scoreId)
      .single();
    if (readError) throw readError;
    const now = new Date().toISOString();
    const updates =
      body.action === 'override'
        ? {
            score: requireScore(body.score),
            override_score: requireScore(body.score),
            override_reason: requireReason(body.reason),
            overridden_by: auth.user.id,
            overridden_at: now,
            updated_by: auth.user.id,
          }
        : {
            score: Number(current.raw_score ?? current.score),
            override_score: null,
            override_reason: null,
            overridden_by: null,
            overridden_at: null,
            updated_by: auth.user.id,
          };
    const { data, error } = await client
      .from('sales_os_intent_scores')
      .update(updates)
      .eq('tenant_id', tenantId)
      .eq('id', body.scoreId)
      .select()
      .single();
    if (error) throw error;
    const { error: eventError } = await client.from('sales_os_events').insert({
      tenant_id: tenantId,
      product_id: current.product_id,
      event_type: 'intent_score_override',
      audience_id: current.audience_id,
      signal_id: current.signal_id,
      dimensions: {
        action: body.action,
        score: data.score,
        reason: body.reason ?? null,
      },
      occurred_at: now,
      idempotency_key: `intent-override:${current.id}:${now}`,
      created_by: auth.user.id,
    });
    if (eventError) throw eventError;
    return json({ data });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Intent review failed.' },
      400,
    );
  }
});

function requireScore(value: number | undefined) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1)
    throw new Error('Override score must be between 0 and 1.');
  return Number(score.toFixed(4));
}

function requireReason(value: string | undefined) {
  const reason = String(value ?? '').trim();
  if (!reason) throw new Error('A reason is required for an intent override.');
  return reason;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

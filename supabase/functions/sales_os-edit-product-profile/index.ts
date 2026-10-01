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
      productId?: string;
      updates?: Record<string, unknown>;
    };
    if (!body.productId || !body.updates)
      throw new Error('productId and updates are required.');
    const { data: current, error: currentError } = await client
      .from('sales_os_product_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .order('version', { ascending: false })
      .limit(1)
      .single();
    if (currentError) throw currentError;
    const allowed = [
      'category',
      'description',
      'problems_solved',
      'core_capabilities',
      'primary_use_cases',
      'pricing_business_model',
      'conversion_event',
      'purchase_friction',
      'competitive_alternatives',
      'purchase_triggers',
      'positioning_value_props',
      'outreach_motion',
      'outreach_motion_reason',
      'collateral_strategy',
    ];
    const updates = Object.fromEntries(
      Object.entries(body.updates).filter(([key]) => allowed.includes(key)),
    );
    const labelKeys: Record<string, string> = {
      category: 'category',
      description: 'description',
      problems_solved: 'problemsSolved',
      primary_use_cases: 'primaryUseCases',
      competitive_alternatives: 'competitiveAlternatives',
      purchase_friction: 'purchaseFriction',
      conversion_event: 'conversionEvent',
    };
    const displayLabels = {
      ...((current.display_labels ?? {}) as Record<string, unknown>),
    };
    for (const key of Object.keys(updates))
      if (labelKeys[key]) delete displayLabels[labelKeys[key]];
    const next = {
      ...current,
      ...updates,
      tenant_id: tenantId,
      product_id: body.productId,
      version: current.version + 1,
      is_active: false,
      review_status: 'needs_review',
      display_labels: displayLabels,
      created_by: userData.user.id,
      updated_by: userData.user.id,
    };
    delete next.id;
    delete next.created_at;
    delete next.updated_at;
    const { data, error } = await client
      .from('sales_os_product_profiles')
      .insert(next)
      .select()
      .single();
    if (error) throw error;
    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Profile edit failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

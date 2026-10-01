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
const settingKeys = new Set([
  'attribution_window_days',
  'evidence_score_minimum',
  'sending_limit_daily',
  'follow_up_limit',
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
      action?: string;
      productId?: string;
      providerId?: string;
      settingKey?: string;
      value?: unknown;
      monthlySpendCap?: number | null;
      perRunSpendCap?: number | null;
      platform?: string;
      externalAccountId?: string;
      displayLabel?: string;
      enabled?: boolean;
    };
    if (!body.action) throw new Error('action is required.');
    let data;
    if (body.action === 'update_product_caps') {
      if (!body.productId) throw new Error('productId is required.');
      const result = await client
        .from('sales_os_products')
        .update({
          monthly_spend_cap: body.monthlySpendCap ?? null,
          per_run_spend_cap: body.perRunSpendCap ?? null,
          updated_by: userData.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('id', body.productId)
        .select()
        .single();
      if (result.error) throw result.error;
      data = result.data;
    } else if (body.action === 'update_provider') {
      if (!body.providerId || typeof body.enabled !== 'boolean')
        throw new Error('providerId and enabled are required.');
      const result = await client
        .from('sales_os_providers')
        .update({ enabled: body.enabled, updated_by: userData.user.id })
        .eq('tenant_id', tenantId)
        .eq('id', body.providerId)
        .select()
        .single();
      if (result.error) throw result.error;
      data = result.data;
    } else if (body.action === 'upsert_operating_setting') {
      if (!body.productId || !body.settingKey || !settingKeys.has(body.settingKey))
        throw new Error('Invalid operating setting.');
      const result = await client
        .from('sales_os_operating_settings')
        .upsert(
          {
            tenant_id: tenantId,
            product_id: body.productId,
            setting_key: body.settingKey,
            value: body.value ?? {},
            created_by: userData.user.id,
            updated_by: userData.user.id,
          },
          { onConflict: 'tenant_id,product_id,setting_key' },
        )
        .select()
        .single();
      if (result.error) throw result.error;
      data = result.data;
    } else if (body.action === 'upsert_channel_account') {
      if (!body.platform || !body.externalAccountId || !body.displayLabel)
        throw new Error('platform, externalAccountId, and displayLabel are required.');
      if (!['reddit', 'community', 'professional_social'].includes(body.platform))
        throw new Error('Unsupported channel platform.');
      const result = await client
        .from('sales_os_channel_accounts')
        .upsert(
          {
            tenant_id: tenantId,
            product_id: body.productId ?? null,
            platform: body.platform,
            external_account_id: body.externalAccountId,
            display_label: body.displayLabel,
            enabled: body.enabled ?? false,
            updated_by: userData.user.id,
            created_by: userData.user.id,
          },
          { onConflict: 'tenant_id,platform,external_account_id' },
        )
        .select()
        .single();
      if (result.error) throw result.error;
      data = result.data;
    } else throw new Error('Unsupported settings action.');
    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Settings update failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

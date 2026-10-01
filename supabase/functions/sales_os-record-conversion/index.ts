import { createClient } from 'npm:@supabase/supabase-js@2';
import { calculateAttribution } from '../_shared/attribution.ts';
import { enqueueLearningAnalysis } from '../_shared/learning.ts';

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
      eventId?: string;
      conversionType?: 'signup' | 'trial' | 'purchase' | 'subscription' | 'other';
      value?: number;
      currency?: string;
      customerExternalId?: string;
      anonymousId?: string;
      salesAttributionId?: string;
      convertedAt?: string;
      attributionWindowDays?: number;
    };
    if (!body.productId || !body.eventId || !body.conversionType)
      throw new Error('productId, eventId, and conversionType are required.');
    const { data: sourceEvent, error: sourceEventError } = await client
      .from('sales_os_events')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .eq('id', body.eventId)
      .maybeSingle();
    if (sourceEventError) throw sourceEventError;
    if (!sourceEvent)
      throw new Error('Conversion event does not exist for this product.');
    const convertedAt = body.convertedAt ?? new Date().toISOString();
    const windowDays = body.attributionWindowDays ?? 30;
    const { data: events, error: eventsError } = await client
      .from('sales_os_events')
      .select('id,event_type,occurred_at,opportunity_id,engagement_id,dimensions')
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .lte('occurred_at', convertedAt)
      .order('occurred_at', { ascending: true });
    if (eventsError) throw eventsError;
    const attribution = calculateAttribution(events ?? [], convertedAt, windowDays);
    const { data, error } = await client
      .from('sales_os_conversions')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: body.productId,
          event_id: body.eventId,
          conversion_type: body.conversionType,
          value: body.value ?? null,
          currency: body.currency ?? 'USD',
          customer_external_id: body.customerExternalId ?? null,
          converted_at: convertedAt,
          first_touch_opportunity_id: attribution.firstTouch?.opportunity_id ?? null,
          first_touch_dimensions: attribution.firstTouch?.dimensions ?? {},
          last_touch_engagement_id: attribution.lastTouch?.engagement_id ?? null,
          last_touch_dimensions: attribution.lastTouch?.dimensions ?? {},
          attribution_window_days: windowDays,
          created_by: userData.user.id,
          updated_by: userData.user.id,
        },
        { onConflict: 'tenant_id,event_id', ignoreDuplicates: true },
      )
      .select()
      .single();
    if (error) throw error;
    const analyticsEventName =
      body.conversionType === 'signup'
        ? 'user_signed_up'
        : body.conversionType === 'trial'
          ? 'trial_started'
          : body.conversionType === 'purchase'
            ? 'pass_purchased'
            : body.conversionType === 'subscription'
              ? 'subscription_started'
              : 'conversion_recorded';
    const { error: analyticsError } = await client.from('sales_os_admin_events').upsert(
      {
        tenant_id: tenantId,
        product_id: body.productId,
        event_name: analyticsEventName,
        occurred_at: convertedAt,
        user_id: userData.user.id,
        anonymous_id: body.anonymousId ?? null,
        properties: {
          conversion_type: body.conversionType,
          value: body.value ?? null,
          currency: body.currency ?? 'USD',
        },
        source: 'server',
        sales_attribution_id: body.salesAttributionId ?? null,
        idempotency_key: `conversion-analytics:${body.eventId}`,
      },
      { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true },
    );
    if (analyticsError) throw analyticsError;
    await enqueueLearningAnalysis(client, body.productId, userData.user.id);
    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Conversion recording failed.',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});

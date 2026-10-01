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
      eventType?: string;
      occurredAt?: string;
      value?: number;
      currency?: string;
      customerExternalId?: string;
      anonymousId?: string;
      salesAttributionId?: string;
      dimensions?: Record<string, unknown>;
    };
    if (!body.productId || !body.eventId || !body.eventType)
      throw new Error('productId, eventId, and eventType are required.');
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(body.eventType))
      throw new Error('eventType must use the lowercase underscore event format.');
    const occurredAt = body.occurredAt ?? new Date().toISOString();
    const { data: event, error: eventError } = await client
      .from('sales_os_events')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: body.productId,
          event_type: body.eventType,
          occurred_at: occurredAt,
          external_event_id: body.eventId,
          dimensions: body.dimensions ?? {},
          idempotency_key: `product-event:${body.eventId}`,
          created_by: userData.user.id,
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      )
      .select()
      .maybeSingle();
    if (eventError) throw eventError;
    const { error: adminEventError } = await client
      .from('sales_os_admin_events')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: body.productId,
          event_name: body.eventType,
          occurred_at: occurredAt,
          user_id: userData.user.id,
          anonymous_id: body.anonymousId ?? null,
          properties: body.dimensions ?? {},
          source: 'server',
          sales_attribution_id:
            body.salesAttributionId ??
            (typeof body.dimensions?.sales_attribution_id === 'string'
              ? body.dimensions.sales_attribution_id
              : null),
          idempotency_key: `product-event:${body.eventId}`,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true },
      );
    if (adminEventError) throw adminEventError;
    const { data: profile, error: profileError } = await client
      .from('sales_os_product_profiles')
      .select('conversion_event')
      .eq('tenant_id', tenantId)
      .eq('product_id', body.productId)
      .eq('is_active', true)
      .maybeSingle();
    if (profileError) throw profileError;
    const conversionEvent = profile?.conversion_event as
      Record<string, unknown> | null | undefined;
    if (event && conversionEvent?.eventName === body.eventType) {
      const conversionType = conversionEvent.conversionType;
      if (
        !['signup', 'trial', 'purchase', 'subscription', 'other'].includes(
          String(conversionType),
        )
      )
        throw new Error('Configured conversion type is invalid.');
      const { data: priorEvents, error: priorEventsError } = await client
        .from('sales_os_events')
        .select(
          'id, event_type, occurred_at, opportunity_id, engagement_id, dimensions',
        )
        .eq('tenant_id', tenantId)
        .eq('product_id', body.productId)
        .lte('occurred_at', occurredAt);
      if (priorEventsError) throw priorEventsError;
      const attribution = calculateAttribution(
        (priorEvents ?? []) as Array<Record<string, unknown>>,
        occurredAt,
      );
      const { error: conversionError } = await client
        .from('sales_os_conversions')
        .upsert(
          {
            tenant_id: tenantId,
            product_id: body.productId,
            event_id: event.id,
            conversion_type: conversionType,
            value: body.value ?? null,
            currency: body.currency ?? 'USD',
            customer_external_id: body.customerExternalId ?? null,
            converted_at: occurredAt,
            first_touch_opportunity_id: attribution.firstTouch?.opportunity_id ?? null,
            first_touch_dimensions: attribution.firstTouch?.dimensions ?? {},
            last_touch_engagement_id: attribution.lastTouch?.engagement_id ?? null,
            last_touch_dimensions: attribution.lastTouch?.dimensions ?? {},
            attribution_window_days: 30,
            created_by: userData.user.id,
            updated_by: userData.user.id,
          },
          { onConflict: 'tenant_id,event_id', ignoreDuplicates: true },
        );
      if (conversionError) throw conversionError;
    }
    if (
      ['signup', 'trial_started', 'purchase', 'subscription_started'].includes(
        body.eventType,
      )
    ) {
      await enqueueLearningAnalysis(client, body.productId, userData.user.id);
    }
    return new Response(
      JSON.stringify({ data: event, conversionEvaluated: Boolean(event) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : 'Product event ingestion failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

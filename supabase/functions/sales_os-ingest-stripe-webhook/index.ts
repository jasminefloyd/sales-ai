import { createClient } from 'npm:@supabase/supabase-js@2';
import { calculateAttribution } from '../_shared/attribution.ts';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
const stripeWebhookSecret = Deno.env.get('SALES_OS_STRIPE_WEBHOOK_SECRET');
if (!supabaseUrl || !serviceRoleKey || !stripeWebhookSecret)
  throw new Error('Missing Sales OS Stripe webhook configuration.');
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (request) => {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');
    if (
      !signature ||
      !(await verifyStripeSignature(rawBody, signature, stripeWebhookSecret))
    )
      return new Response('Invalid signature.', { status: 400 });
    const event = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      created?: number;
      data?: { object?: Record<string, unknown> };
    };
    if (!event.id || !event.type)
      throw new Error('Stripe event id and type are required.');
    const object = event.data?.object ?? {};
    const metadata = (object.metadata ?? {}) as Record<string, unknown>;
    const productId =
      typeof metadata.sales_os_product_id === 'string'
        ? metadata.sales_os_product_id
        : undefined;
    if (!productId)
      return new Response(
        JSON.stringify({
          accepted: true,
          mapped: false,
          reason: 'missing_sales_os_product_id',
        }),
        { status: 202 },
      );
    const conversionType = stripeConversionType(event.type);
    const adminEventName = stripeAdminEventName(event.type);
    const occurredAt = new Date(
      (event.created ?? Math.floor(Date.now() / 1000)) * 1000,
    ).toISOString();
    const { data: ledgerEvent, error: eventError } = await client
      .from('sales_os_events')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: productId,
          event_type: event.type,
          occurred_at: occurredAt,
          external_event_id: event.id,
          dimensions: { provider: 'stripe', stripeEventType: event.type },
          idempotency_key: `stripe:${event.id}`,
          created_by: 'stripe_webhook',
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      )
      .select()
      .maybeSingle();
    if (eventError) throw eventError;
    if (adminEventName) {
      const { error: adminEventError } = await client.from('sales_os_admin_events').upsert(
        {
          tenant_id: tenantId,
          product_id: productId,
          event_name: adminEventName,
          occurred_at: occurredAt,
          properties: {
            provider: 'stripe',
            stripe_event_id: event.id,
            stripe_event_type: event.type,
            amount_total: object.amount_total ?? null,
            currency: object.currency ?? null,
            customer: object.customer ?? null,
          },
          source: 'stripe',
          idempotency_key: `stripe-admin:${event.id}`,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true },
      );
      if (adminEventError) throw adminEventError;
    }
    if (ledgerEvent && conversionType) {
      const { data: priorEvents, error: priorEventsError } = await client
        .from('sales_os_events')
        .select(
          'id, event_type, occurred_at, opportunity_id, engagement_id, dimensions',
        )
        .eq('tenant_id', tenantId)
        .eq('product_id', productId)
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
            product_id: productId,
            event_id: ledgerEvent.id,
            conversion_type: conversionType,
            value:
              typeof object.amount_total === 'number'
                ? object.amount_total / 100
                : null,
            currency:
              typeof object.currency === 'string'
                ? object.currency.toUpperCase()
                : 'USD',
            customer_external_id:
              typeof object.customer === 'string' ? object.customer : null,
            converted_at: occurredAt,
            first_touch_opportunity_id: attribution.firstTouch?.opportunity_id ?? null,
            first_touch_dimensions: attribution.firstTouch?.dimensions ?? {},
            last_touch_engagement_id: attribution.lastTouch?.engagement_id ?? null,
            last_touch_dimensions: attribution.lastTouch?.dimensions ?? {},
            attribution_window_days: 30,
            created_by: 'stripe_webhook',
            updated_by: 'stripe_webhook',
          },
          { onConflict: 'tenant_id,event_id', ignoreDuplicates: true },
        );
      if (conversionError) throw conversionError;
    }
    return new Response(
      JSON.stringify({ accepted: true, mapped: Boolean(conversionType) }),
      { status: 200 },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : 'Stripe webhook ingestion failed.',
      }),
      { status: 400 },
    );
  }
});

function stripeConversionType(type: string) {
  if (type === 'checkout.session.completed' || type === 'payment_intent.succeeded')
    return 'purchase';
  if (
    type === 'customer.subscription.created' ||
    type === 'customer.subscription.updated'
  )
    return 'subscription';
  return null;
}

function stripeAdminEventName(type: string) {
  if (type === 'checkout.session.completed' || type === 'payment_intent.succeeded') return 'pass_purchased';
  if (type === 'customer.subscription.created') return 'subscription_started';
  if (type === 'customer.subscription.updated') return 'subscription_renewed';
  if (type === 'customer.subscription.deleted') return 'subscription_cancelled';
  if (type === 'invoice.payment_failed') return 'payment_failed';
  return null;
}

async function verifyStripeSignature(payload: string, header: string, secret: string) {
  const values = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = values.t;
  const signature = values.v1;
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return expected === signature;
}

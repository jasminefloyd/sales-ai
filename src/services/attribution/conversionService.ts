import type { SupabaseClient } from '@supabase/supabase-js';

import { calculateAttribution } from './attribution';

const tenantId = 'sales_os';

export async function recordConversion(
  client: SupabaseClient,
  input: {
    productId: string;
    eventId: string;
    conversionType: 'signup' | 'trial' | 'purchase' | 'subscription' | 'other';
    value?: number;
    currency?: string;
    customerExternalId?: string;
    convertedAt?: string;
    attributionWindowDays?: number;
    actor: string;
  },
) {
  const convertedAt = input.convertedAt ?? new Date().toISOString();
  const windowDays = input.attributionWindowDays ?? 30;
  const { data: events, error: eventsError } = await client
    .from('sales_os_events')
    .select('id, event_type, occurred_at, opportunity_id, engagement_id, dimensions')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .lte('occurred_at', convertedAt)
    .order('occurred_at', { ascending: true });
  if (eventsError) throw eventsError;
  const attribution = calculateAttribution(
    (events ?? []) as never[],
    convertedAt,
    windowDays,
  );
  const { data: conversion, error: conversionError } = await client
    .from('sales_os_conversions')
    .upsert(
      {
        tenant_id: tenantId,
        product_id: input.productId,
        event_id: input.eventId,
        conversion_type: input.conversionType,
        value: input.value ?? null,
        currency: input.currency ?? 'USD',
        customer_external_id: input.customerExternalId ?? null,
        converted_at: convertedAt,
        first_touch_opportunity_id: attribution.firstTouch?.opportunity_id ?? null,
        first_touch_dimensions: attribution.firstTouch?.dimensions ?? {},
        last_touch_engagement_id: attribution.lastTouch?.engagement_id ?? null,
        last_touch_dimensions: attribution.lastTouch?.dimensions ?? {},
        attribution_window_days: windowDays,
        created_by: input.actor,
        updated_by: input.actor,
      },
      { onConflict: 'tenant_id,event_id' },
    )
    .select()
    .single();
  if (conversionError) throw conversionError;
  return conversion;
}

export async function recomputeLastTouch(
  client: SupabaseClient,
  input: { productId: string; conversionId: string; actor: string },
) {
  const { data: conversion, error: conversionError } = await client
    .from('sales_os_conversions')
    .select(
      'id, event_id, converted_at, attribution_window_days, last_touch_engagement_id, last_touch_dimensions',
    )
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('id', input.conversionId)
    .single();
  if (conversionError) throw conversionError;
  const { data: events, error: eventsError } = await client
    .from('sales_os_events')
    .select('id, event_type, occurred_at, opportunity_id, engagement_id, dimensions')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .lte('occurred_at', conversion.converted_at)
    .order('occurred_at', { ascending: true });
  if (eventsError) throw eventsError;
  const attribution = calculateAttribution(
    (events ?? []) as never[],
    conversion.converted_at,
    conversion.attribution_window_days,
  );
  const nextId = attribution.lastTouch?.engagement_id ?? null;
  if (nextId === conversion.last_touch_engagement_id) return conversion;
  const { data: updated, error: updateError } = await client
    .from('sales_os_conversions')
    .update({
      last_touch_engagement_id: nextId,
      last_touch_dimensions: attribution.lastTouch?.dimensions ?? {},
      updated_by: input.actor,
    })
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('id', input.conversionId)
    .select()
    .single();
  if (updateError) throw updateError;
  const { error: auditError } = await client
    .from('sales_os_conversion_attribution_history')
    .insert({
      tenant_id: tenantId,
      conversion_id: input.conversionId,
      previous_last_touch_engagement_id: conversion.last_touch_engagement_id,
      next_last_touch_engagement_id: nextId,
      previous_last_touch_dimensions: conversion.last_touch_dimensions ?? {},
      next_last_touch_dimensions: attribution.lastTouch?.dimensions ?? {},
      reason: 'late_event_recomputation',
      created_by: input.actor,
    });
  if (auditError) throw auditError;
  return updated;
}

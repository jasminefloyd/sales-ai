import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';

export type SalesOsEventInput = {
  productId: string;
  eventType: string;
  idempotencyKey: string;
  occurredAt?: string;
  dimensions: Record<string, unknown>;
  opportunityId?: string;
  audienceId?: string;
  accountId?: string;
  contactId?: string;
  engagementId?: string;
  sourceId?: string;
  signalId?: string;
  providerId?: string;
  contactRole?: string;
  messageAngle?: string;
  cta?: string;
  followUpCadence?: string;
  externalEventId?: string;
  createdBy: string;
};

export function buildEventInsert(input: SalesOsEventInput) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    event_type: input.eventType,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    dimensions: input.dimensions,
    idempotency_key: input.idempotencyKey,
    created_by: input.createdBy,
    ...(input.opportunityId && { opportunity_id: input.opportunityId }),
    ...(input.audienceId && { audience_id: input.audienceId }),
    ...(input.accountId && { account_id: input.accountId }),
    ...(input.contactId && { contact_id: input.contactId }),
    ...(input.engagementId && { engagement_id: input.engagementId }),
    ...(input.sourceId && { source_id: input.sourceId }),
    ...(input.signalId && { signal_id: input.signalId }),
    ...(input.providerId && { provider_id: input.providerId }),
    ...(input.contactRole && { contact_role: input.contactRole }),
    ...(input.messageAngle && { message_angle: input.messageAngle }),
    ...(input.cta && { cta: input.cta }),
    ...(input.followUpCadence && { follow_up_cadence: input.followUpCadence }),
    ...(input.externalEventId && { external_event_id: input.externalEventId }),
  };
}

/** Writes only through the append-only event table and preserves idempotency. */
export async function appendSalesOsEvent(
  client: SupabaseClient,
  input: SalesOsEventInput,
) {
  const payload = buildEventInsert(input);
  const { data, error } = await client
    .from('sales_os_events')
    .upsert(payload, {
      onConflict: 'tenant_id,product_id,idempotency_key',
      ignoreDuplicates: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

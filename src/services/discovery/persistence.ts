import type { SupabaseClient } from '@supabase/supabase-js';

import { buildEventInsert } from '../events/eventService';
import {
  buildOpportunityInsert,
  buildSourceInsert,
  type NormalizedCandidate,
  type QualificationDecision,
} from './social';

export async function persistQualifiedSocialOpportunity(
  client: SupabaseClient,
  input: {
    productId: string;
    audienceId: string;
    sourceProviderId?: string;
    signalId?: string;
    candidate: NormalizedCandidate;
    qualification: QualificationDecision;
    aiFitAssessment: string;
    recommendedAction: string;
    actor: string;
  },
) {
  if (!input.qualification.qualified) {
    throw new Error('Only qualified candidates may become opportunities.');
  }
  const sourcePayload = buildSourceInsert({
    productId: input.productId,
    providerId: input.sourceProviderId,
    candidate: input.candidate,
    actor: input.actor,
  });
  const existingSourceQuery = client
    .from('sales_os_sources')
    .select()
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .eq('url', input.candidate.canonicalUrl);
  const { data: existingSources, error: existingSourceError } =
    await existingSourceQuery;
  if (existingSourceError) throw existingSourceError;
  const existingSource = existingSources?.[0];
  const { data: source, error: sourceError } = existingSource
    ? { data: existingSource, error: null }
    : await client.from('sales_os_sources').insert(sourcePayload).select().single();
  if (sourceError) throw sourceError;

  const opportunityInsert = buildOpportunityInsert({
    productId: input.productId,
    audienceId: input.audienceId,
    sourceId: source.id,
    signalId: input.signalId,
    routeType: 'social',
    candidate: input.candidate,
    qualification: input.qualification,
    aiFitAssessment: input.aiFitAssessment,
    recommendedAction: input.recommendedAction,
    actor: input.actor,
  });
  const { data: opportunity, error: opportunityError } = await client
    .from('sales_os_opportunities')
    .insert(opportunityInsert)
    .select()
    .single();
  if (opportunityError) throw opportunityError;

  const event = buildEventInsert({
    productId: input.productId,
    opportunityId: opportunity.id,
    sourceId: source.id,
    signalId: input.signalId,
    eventType: 'opportunity_discovered',
    idempotencyKey: `opportunity-discovered:${opportunity.id}`,
    dimensions: {
      routeType: 'social',
      evidenceScore: input.qualification.evidenceScore,
    },
    createdBy: input.actor,
  });
  const { error: eventError } = await client.from('sales_os_events').upsert(event, {
    onConflict: 'tenant_id,product_id,idempotency_key',
    ignoreDuplicates: true,
  });
  if (eventError) throw eventError;
  return { opportunity, source };
}

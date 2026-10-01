import type { SupabaseClient } from '@supabase/supabase-js';

import { buildEventInsert } from '../events/eventService';
import {
  buildDirectOpportunityInsert,
  type DirectAccountCandidate,
  type DirectContactCandidate,
  type DirectPersonCandidate,
  type DirectQualificationDecision,
} from './direct';

export async function persistDirectOpportunity(
  client: SupabaseClient,
  input: {
    productId: string;
    audienceId: string;
    sourceId: string;
    signalId?: string;
    accountId: string;
    contactId: string;
    account: DirectAccountCandidate;
    person: DirectPersonCandidate;
    contact?: DirectContactCandidate;
    qualification: DirectQualificationDecision;
    aiFitAssessment: string;
    recommendedAction: string;
    actor: string;
  },
) {
  if (!input.qualification.qualified) {
    throw new Error('Only qualified direct candidates may become opportunities.');
  }
  const { data: opportunity, error: opportunityError } = await client
    .from('sales_os_opportunities')
    .insert(buildDirectOpportunityInsert(input))
    .select()
    .single();
  if (opportunityError) throw opportunityError;

  const event = buildEventInsert({
    productId: input.productId,
    opportunityId: opportunity.id,
    accountId: input.accountId,
    contactId: input.contactId,
    sourceId: input.sourceId,
    signalId: input.signalId,
    eventType: 'opportunity_discovered',
    idempotencyKey: `opportunity-discovered:${opportunity.id}`,
    dimensions: {
      routeType: 'direct',
      evidenceScore: input.qualification.evidenceScore,
      emailReady: input.qualification.emailReady,
    },
    createdBy: input.actor,
  });
  const { error: eventError } = await client.from('sales_os_events').upsert(event, {
    onConflict: 'tenant_id,product_id,idempotency_key',
    ignoreDuplicates: true,
  });
  if (eventError) throw eventError;
  return opportunity;
}

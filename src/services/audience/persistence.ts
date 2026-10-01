import type { SupabaseClient } from '@supabase/supabase-js';

import type { AudienceProposalInput } from './audienceService';
import { buildAudienceProposal } from './audienceService';

export async function persistAudienceProposal(
  client: SupabaseClient,
  input: AudienceProposalInput,
) {
  const proposal = buildAudienceProposal(input);
  const { data: audience, error: audienceError } = await client
    .from('sales_os_audiences')
    .insert(proposal.audience)
    .select()
    .single();
  if (audienceError) throw audienceError;

  const routes = proposal.routes.map((route) => ({
    ...route,
    audience_id: audience.id,
  }));
  const { data: persistedRoutes, error: routesError } = await client
    .from('sales_os_audience_routes')
    .insert(routes)
    .select();
  if (routesError) throw routesError;
  return { audience, routes: persistedRoutes };
}

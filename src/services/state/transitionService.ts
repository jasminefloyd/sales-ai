import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import { assertValidStateTransition, type StateEntity } from './transitions';

const tableByEntity: Record<StateEntity, string> = {
  product: 'sales_os_products',
  audience: 'sales_os_audiences',
  opportunity: 'sales_os_opportunities',
  engagement: 'sales_os_engagements',
  learning: 'sales_os_learnings',
  approval: 'sales_os_approvals',
  job: 'sales_os_jobs',
};

export type TransitionRequest = {
  entity: StateEntity;
  id: string;
  from: string;
  to: string;
  actor: string;
  productId?: string;
};

export function transitionUpdate(request: TransitionRequest) {
  assertValidStateTransition(request.entity, request.from, request.to);
  return {
    status: request.to,
    updated_by: request.actor,
    state_changed_by: request.actor,
  };
}

/**
 * Server-side state transition service. Browser clients do not receive update
 * RLS policies, so state changes must use a trusted service boundary.
 */
export async function transitionState(
  client: SupabaseClient,
  request: TransitionRequest,
) {
  const update = transitionUpdate(request);
  let query = client
    .from(tableByEntity[request.entity])
    .update(update)
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', request.id);

  if (request.productId) query = query.eq('product_id', request.productId);

  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

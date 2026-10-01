import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';

const approvedStatuses = new Set(['approved', 'active']);

export function isApprovedFindRouteStatus(status: string): boolean {
  return approvedStatuses.has(status);
}

export async function assertApprovedFindRoute(
  client: SupabaseClient,
  input: { productId: string; audienceId: string; routeId: string },
): Promise<void> {
  const { data, error } = await client
    .from('sales_os_audience_routes')
    .select('status')
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('product_id', input.productId)
    .eq('audience_id', input.audienceId)
    .eq('id', input.routeId)
    .single();
  if (error) throw error;
  if (!data || !isApprovedFindRouteStatus(data.status)) {
    throw new Error('Find runs require an approved or active audience route.');
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';

export type BudgetSnapshot = {
  monthlySpend: number;
  activeReservations: number;
  requestedCost: number;
  monthlyCap: number | null;
  perRunCap: number | null;
};

export type BudgetDecision = BudgetSnapshot & {
  allowed: boolean;
  reason: 'reserved' | 'monthly_cap_exceeded' | 'per_run_cap_exceeded';
};

export function evaluateBudget(snapshot: BudgetSnapshot): BudgetDecision {
  if (snapshot.perRunCap !== null && snapshot.requestedCost > snapshot.perRunCap) {
    return { ...snapshot, allowed: false, reason: 'per_run_cap_exceeded' };
  }
  if (
    snapshot.monthlyCap !== null &&
    snapshot.monthlySpend + snapshot.activeReservations + snapshot.requestedCost >
      snapshot.monthlyCap
  ) {
    return { ...snapshot, allowed: false, reason: 'monthly_cap_exceeded' };
  }
  return { ...snapshot, allowed: true, reason: 'reserved' };
}

export type BudgetRpcResult = BudgetDecision & { reservation_id: string | null };

export async function checkBudget(
  client: SupabaseClient,
  input: {
    productId: string;
    estimatedCost: number;
    jobId?: string;
    requestedBy: string;
  },
): Promise<BudgetRpcResult> {
  const { data, error } = await client.rpc('sales_os_check_budget', {
    p_product_id: input.productId,
    p_estimated_cost: input.estimatedCost,
    p_job_id: input.jobId ?? null,
    p_requested_by: input.requestedBy,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return {
    allowed: result.allowed,
    reason: result.reason,
    reservation_id: result.reservation_id,
    monthlySpend: Number(result.monthly_spend),
    activeReservations: Number(result.active_reservations),
    requestedCost: Number(result.requested_cost),
    monthlyCap: result.monthly_cap === null ? null : Number(result.monthly_cap),
    perRunCap: result.per_run_cap === null ? null : Number(result.per_run_cap),
  };
}

export async function finalizeBudgetReservation(
  client: SupabaseClient,
  reservationId: string,
  status: 'released' | 'consumed',
  actor: string,
): Promise<void> {
  const { error } = await client
    .from('sales_os_budget_reservations')
    .update({ status, updated_by: actor })
    .eq('tenant_id', 'sales_os')
    .eq('id', reservationId);
  if (error) throw error;
}

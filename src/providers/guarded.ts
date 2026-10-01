import type { SupabaseClient } from '@supabase/supabase-js';

import {
  checkBudget,
  finalizeBudgetReservation,
  type BudgetRpcResult,
} from '../services/budget/budget';
import type { CapabilityInput, CapabilityName, CapabilityResult } from './capabilities';
import { executeCapability, type ProviderExecutionContext } from './runner';
import type { ProviderRunRecorder } from './runs';
import { ProviderRegistry } from './registry';

export type GuardedExecution =
  | { status: 'paused_budget'; budget: BudgetRpcResult; result: null }
  | { status: 'executed'; budget: BudgetRpcResult; result: CapabilityResult }
  | { status: 'failed'; budget: BudgetRpcResult; result: null; error: unknown };

export async function executeCapabilityWithBudget(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  capability: CapabilityName,
  input: CapabilityInput,
  context: ProviderExecutionContext,
): Promise<GuardedExecution> {
  const budget = await checkBudget(client, {
    productId: context.productId,
    estimatedCost: context.estimatedCost,
    jobId: context.jobId,
    requestedBy: context.actor,
  });
  if (!budget.allowed) return { status: 'paused_budget', budget, result: null };

  try {
    const result = await executeCapability(
      registry,
      recorder,
      capability,
      input,
      context,
    );
    if (budget.reservation_id) {
      await finalizeBudgetReservation(
        client,
        budget.reservation_id,
        'consumed',
        context.actor,
      );
    }
    return { status: 'executed', budget, result };
  } catch (error) {
    if (budget.reservation_id) {
      await finalizeBudgetReservation(
        client,
        budget.reservation_id,
        'released',
        context.actor,
      );
    }
    return { status: 'failed', budget, result: null, error };
  }
}

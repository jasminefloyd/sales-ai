import { describe, expect, it } from 'vitest';

import { executeCapabilityWithBudget } from './guarded';
import { InMemoryProviderRunRecorder } from './runs';
import { ProviderRegistry } from './registry';

describe('budget-guarded provider execution', () => {
  it('does not call a provider when the budget RPC denies the reservation', async () => {
    const client = {
      rpc: async () => ({
        data: [
          {
            allowed: false,
            reason: 'monthly_cap_exceeded',
            reservation_id: null,
            monthly_spend: 10,
            active_reservations: 0,
            requested_cost: 1,
            monthly_cap: 10,
            per_run_cap: null,
          },
        ],
        error: null,
      }),
    } as never;
    const recorder = new InMemoryProviderRunRecorder();

    const result = await executeCapabilityWithBudget(
      client,
      new ProviderRegistry(),
      recorder,
      'searchWeb',
      {},
      { productId: 'product-a', estimatedCost: 1, actor: 'test' },
    );

    expect(result.status).toBe('paused_budget');
    expect(recorder.runs).toHaveLength(0);
  });
});

import { z } from 'zod';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';

const RoleRecommendationSchema = z.object({
  roles: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1),
});

export async function recommendPurchasingRoles(
  client: Parameters<typeof executeCapabilityWithBudget>[0],
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    product: Record<string, unknown>;
    audience: Record<string, unknown>;
  },
) {
  const context: ProviderExecutionContext = {
    productId: input.productId,
    jobId: input.jobId,
    actor: input.actor,
    estimatedCost: input.estimatedCost,
    requestReference: `role-recommendation:${input.jobId}`,
  };
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'reasoning',
    {
      task: 'recommend_purchasing_roles',
      product: input.product,
      audience: input.audience,
    },
    context,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  return { ...result, roles: RoleRecommendationSchema.parse(result.result.data) };
}

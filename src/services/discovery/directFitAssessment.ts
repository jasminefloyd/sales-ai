import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';
import { validateFitAssessment } from './fitAssessment';
import type {
  DirectAccountCandidate,
  DirectContactCandidate,
  DirectPersonCandidate,
} from './direct';

export async function assessDirectCandidateFit(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    productContext: Record<string, unknown>;
    audienceContext: Record<string, unknown>;
    account: DirectAccountCandidate;
    person: DirectPersonCandidate;
    contact?: DirectContactCandidate;
  },
) {
  const context: ProviderExecutionContext = {
    productId: input.productId,
    jobId: input.jobId,
    estimatedCost: input.estimatedCost,
    actor: input.actor,
    requestReference: `direct-fit:${input.account.domain}:${input.person.fullName}`,
  };
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'reasoning',
    {
      task: 'direct_opportunity_fit_assessment',
      product: input.productContext,
      audience: input.audienceContext,
      account: input.account,
      person: input.person,
      contact: input.contact ?? null,
      observedEvidence: [
        ...input.account.evidence,
        ...input.person.evidence,
        ...(input.contact?.evidence ?? []),
      ],
    },
    context,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  return { ...result, assessment: validateFitAssessment(result.result.data) };
}

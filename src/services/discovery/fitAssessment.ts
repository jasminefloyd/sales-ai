import { z } from 'zod';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';
import type { NormalizedCandidate } from './social';

const FitAssessmentSchema = z.object({
  assessment: z.string().min(1),
  recommendedAction: z.string().min(1),
});

export type FitAssessment = z.infer<typeof FitAssessmentSchema>;

export function validateFitAssessment(input: unknown): FitAssessment {
  return FitAssessmentSchema.parse(input);
}

export async function assessSocialCandidateFit(
  client: Parameters<typeof executeCapabilityWithBudget>[0],
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    productContext: Record<string, unknown>;
    audienceContext: Record<string, unknown>;
    candidate: NormalizedCandidate;
  },
) {
  const context: ProviderExecutionContext = {
    productId: input.productId,
    jobId: input.jobId,
    estimatedCost: input.estimatedCost,
    actor: input.actor,
  };
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'reasoning',
    {
      task: 'social_opportunity_fit_assessment',
      product: input.productContext,
      audience: input.audienceContext,
      observedEvidence: input.candidate.evidence,
    },
    context,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  return { ...result, assessment: validateFitAssessment(result.result.data) };
}

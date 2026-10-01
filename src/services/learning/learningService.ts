import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';

export const LearningRecommendationSchema = z.object({
  observation: z.string().min(1),
  supportingEvidence: z.array(z.record(z.string(), z.unknown())),
  sampleSize: z.number().int().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']),
  recommendedChange: z.object({
    targetKey: z.enum([
      'audience_priority',
      'audience_status',
      'route_priority',
      'source_priority',
      'signal_weight',
      'contact_role_preference',
      'message_angle_preference',
      'cta_preference',
      'follow_up_cadence',
      'provider_priority',
      'evidence_score_rubric',
    ]),
    targetEntityId: z.string().uuid().nullable(),
    before: z.unknown(),
    after: z.unknown(),
  }),
  targetPhase: z.enum(['product_audience', 'route_find', 'engage', 'provider_layer']),
});

export type LearningRecommendation = z.infer<typeof LearningRecommendationSchema>;

export const learningTargetKeys = [
  'audience_priority',
  'audience_status',
  'route_priority',
  'source_priority',
  'signal_weight',
  'contact_role_preference',
  'message_angle_preference',
  'cta_preference',
  'follow_up_cadence',
  'provider_priority',
  'evidence_score_rubric',
] as const;

export function buildLearningProposal(input: {
  productId: string;
  recommendation: LearningRecommendation;
  actor: string;
}) {
  if (input.recommendation.sampleSize < 1)
    throw new Error('Learning proposals require at least one observation.');
  return {
    tenant_id: 'sales_os',
    product_id: input.productId,
    observation: input.recommendation.observation,
    supporting_evidence: input.recommendation.supportingEvidence,
    sample_size: input.recommendation.sampleSize,
    confidence: input.recommendation.confidence,
    recommended_change: input.recommendation.recommendedChange,
    target_phase: input.recommendation.targetPhase,
    target_entity_type: input.recommendation.recommendedChange.targetKey,
    target_entity_id: input.recommendation.recommendedChange.targetEntityId,
    status: 'proposed',
    created_by: input.actor,
    updated_by: input.actor,
    state_changed_by: input.actor,
  };
}

export async function analyzeLearning(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    minimumSampleSize?: number;
  },
) {
  const minimumSampleSize = input.minimumSampleSize ?? 10;
  const { data: events, error } = await client
    .from('sales_os_events')
    .select(
      'event_type, occurred_at, audience_id, opportunity_id, engagement_id, source_id, signal_id, provider_id, contact_role, message_angle, cta, follow_up_cadence, dimensions',
    )
    .eq('tenant_id', 'sales_os')
    .eq('product_id', input.productId)
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  const metrics = aggregateLearningMetrics(events ?? []);
  if (metrics.sampleSize < minimumSampleSize)
    return { status: 'insufficient_sample' as const, metrics, minimumSampleSize };
  const context: ProviderExecutionContext = {
    productId: input.productId,
    jobId: input.jobId,
    actor: input.actor,
    estimatedCost: input.estimatedCost,
    requestReference: `learning-analysis:${input.productId}`,
  };
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'reasoning',
    {
      task: 'learning_analysis',
      productId: input.productId,
      metrics,
      minimumSampleSize,
      allowedTargetKeys: learningTargetKeys,
      constraints: { proposeOnly: true, noArbitraryFields: true },
    },
    context,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  const recommendation = LearningRecommendationSchema.parse(result.result.data);
  const { data: learning, error: learningError } = await client
    .from('sales_os_learnings')
    .insert(
      buildLearningProposal({
        productId: input.productId,
        recommendation,
        actor: input.actor,
      }),
    )
    .select()
    .single();
  if (learningError) throw learningError;
  return { ...result, metrics, recommendation, learning };
}

export function aggregateLearningMetrics(events: readonly Record<string, unknown>[]) {
  const byEventType = events.reduce<Record<string, number>>((counts, event) => {
    const eventType = String(event.event_type ?? 'unknown');
    counts[eventType] = (counts[eventType] ?? 0) + 1;
    return counts;
  }, {});
  const dimensionKeys = [
    'audience',
    'route',
    'source',
    'signal',
    'contactRole',
    'messageAngle',
    'cta',
    'followUpCadence',
    'provider',
  ] as const;
  const breakdowns = Object.fromEntries(
    dimensionKeys.map((key) => [key, {} as Record<string, number>]),
  ) as Record<(typeof dimensionKeys)[number], Record<string, number>>;
  for (const event of events) {
    const values = (event.dimensions ?? {}) as Record<string, unknown>;
    const valuesByKey: Record<string, unknown> = {
      audience: event.audience_id ?? values.audience ?? null,
      route: values.route ?? values.routeType ?? null,
      source: event.source_id ?? values.source ?? values.sourceType ?? null,
      signal: event.signal_id ?? values.signal ?? null,
      contactRole: values.contactRole ?? values.contact_role ?? null,
      messageAngle:
        event.message_angle ?? values.messageAngle ?? values.message_angle ?? null,
      cta: event.cta ?? values.cta ?? null,
      followUpCadence:
        event.follow_up_cadence ??
        values.followUpCadence ??
        values.follow_up_cadence ??
        null,
      provider: event.provider_id ?? values.provider ?? null,
    };
    for (const key of dimensionKeys) {
      const value = valuesByKey[key];
      if (value === null || value === undefined || String(value).trim() === '')
        continue;
      const bucket = String(value);
      breakdowns[key][bucket] = (breakdowns[key][bucket] ?? 0) + 1;
    }
  }
  return {
    sampleSize: events.length,
    byEventType,
    dimensions: events.map((event) => ({
      audienceId: event.audience_id ?? null,
      opportunityId: event.opportunity_id ?? null,
      engagementId: event.engagement_id ?? null,
      sourceId: event.source_id ?? null,
      signalId: event.signal_id ?? null,
      values: event.dimensions ?? {},
    })),
    breakdowns,
  };
}

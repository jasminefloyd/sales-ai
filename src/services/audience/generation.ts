import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';
import { persistAudienceProposal } from './persistence';

const AudienceHypothesesSchema = z.object({
  audiences: z
    .array(
      z.object({
        name: z.string().min(1),
        buyerType: z.enum(['individual', 'organization']),
        problemUseCaseFit: z.string().min(1),
        buyingBehavior: z.record(z.string(), z.unknown()),
        purchaseTriggers: z.array(z.string()),
        relevantTerminology: z.array(z.string()),
        supportingEvidence: z
          .array(
            z.object({
              url: z.string().url().optional(),
              snippet: z.string().min(1),
              sourceType: z.string().min(1),
            }),
          )
          .min(1),
        aiFitAssessment: z.string().min(1),
        priority: z.enum(['low', 'medium', 'high']),
        routes: z
          .array(
            z.object({
              routeType: z.enum(['social', 'direct']),
              rationale: z.string().min(1),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export async function generateAudienceHypotheses(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    profile: Record<string, unknown>;
  },
) {
  const context: ProviderExecutionContext = {
    productId: input.productId,
    jobId: input.jobId,
    actor: input.actor,
    estimatedCost: input.estimatedCost,
    requestReference: `audience-discovery:${input.productId}`,
  };
  const evidenceSearch = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'searchWeb',
    { query: buildAudienceEvidenceQuery(input.profile), numResults: 8 },
    { ...context, requestReference: `${context.requestReference}:evidence` },
  );
  const validatingEvidence =
    evidenceSearch.status === 'executed' && evidenceSearch.result.success
      ? normalizeEvidence(evidenceSearch.result.data)
      : [];
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'reasoning',
    {
      task: 'generate_audience_hypotheses',
      canonicalProductProfile: input.profile,
      validatingEvidence,
      constraints: { doNotApprove: true, doNotInventEvidence: true },
    },
    context,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  const validated = AudienceHypothesesSchema.parse(result.result.data);
  const persisted = [];
  for (const audience of validated.audiences) {
    persisted.push(
      await persistAudienceProposal(client, {
        productId: input.productId,
        name: audience.name,
        buyerType: audience.buyerType,
        problemUseCaseFit: audience.problemUseCaseFit,
        buyingBehavior: audience.buyingBehavior,
        purchaseTriggers: audience.purchaseTriggers,
        relevantTerminology: audience.relevantTerminology,
        supportingEvidence: audience.supportingEvidence,
        evidenceInputs: {
          evidenceCount: audience.supportingEvidence.length,
          sourceDiversity: new Set(
            audience.supportingEvidence.map((evidence) => evidence.sourceType),
          ).size,
          signalSpecificity: 0.75,
          recencyDays: null,
        },
        aiFitAssessment: audience.aiFitAssessment,
        priority: audience.priority,
        routes: audience.routes.map((route) => ({
          ...route,
          searchStrategy: { generatedBy: 'audience_discovery_v1' },
        })),
        actor: input.actor,
      }),
    );
  }
  return { ...result, hypotheses: validated, persisted };
}

function buildAudienceEvidenceQuery(profile: Record<string, unknown>): string {
  const terms = [
    profile.category,
    profile.description,
    ...(Array.isArray(profile.problemsSolved) ? profile.problemsSolved : []),
    ...(Array.isArray(profile.primaryUseCases) ? profile.primaryUseCases : []),
    ...(Array.isArray(profile.purchaseTriggers) ? profile.purchaseTriggers : []),
  ].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  return terms.slice(0, 6).join(' ');
}

function normalizeEvidence(value: unknown): Array<Record<string, string>> {
  const rows = Array.isArray(value)
    ? value
    : value &&
        typeof value === 'object' &&
        Array.isArray((value as { results?: unknown[] }).results)
      ? (value as { results: unknown[] }).results
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url : undefined;
    const title = typeof item.title === 'string' ? item.title : '';
    const highlights = Array.isArray(item.highlights)
      ? item.highlights.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const snippet =
      highlights[0] ?? (typeof item.text === 'string' ? item.text : title);
    return url && snippet ? [{ url, snippet, sourceType: 'web' }] : [];
  });
}

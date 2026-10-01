import { z } from 'zod';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import {
  scoreEvidence,
  type EvidenceScore,
  type EvidenceScoreDetail,
} from '../evidence/scoring';

export const SocialCandidateSchema = z.object({
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  sourceType: z.enum(['reddit', 'forum', 'blog', 'web', 'other']),
  sourceName: z.string().min(1),
  authorIdentifier: z.string().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  externalId: z.string().optional(),
  signalType: z.string().min(1),
  signalSpecificity: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type SocialCandidate = z.infer<typeof SocialCandidateSchema>;

export type SearchPlanInput = {
  productName: string;
  productProfile: {
    problemsSolved: string[];
    primaryUseCases: string[];
    purchaseTriggers: string[];
  };
  audience: {
    name: string;
    relevantTerminology: string[];
    purchaseTriggers: string[];
  };
  activeSignals: Array<{ name: string; description: string; signalType: string }>;
  approvedLearnings?: string[];
};

export type SearchPlan = {
  queryTerms: string[];
  queries: string[];
  contextVersion: 'social_search_plan_v1';
};

export function buildSocialSearchPlan(input: SearchPlanInput): SearchPlan {
  const terms = uniqueStrings([
    ...input.audience.relevantTerminology,
    ...input.audience.purchaseTriggers,
    ...input.productProfile.problemsSolved,
    ...input.productProfile.primaryUseCases,
    ...input.productProfile.purchaseTriggers,
    ...(input.approvedLearnings ?? []),
  ]);
  const signals = input.activeSignals.map((signal) => signal.name).filter(Boolean);
  const queryTerms = uniqueStrings([...terms, ...signals]);
  const queries = queryTerms
    .slice(0, 12)
    .map((term) => `${input.audience.name} ${term}`.trim());
  return { queryTerms, queries, contextVersion: 'social_search_plan_v1' };
}

export type NormalizedCandidate = SocialCandidate & {
  canonicalUrl: string;
  dedupeKey: string;
  recencyDays: number | null;
  evidence: Array<{
    url: string;
    excerpt: string;
    sourceType: string;
    observedAt: string | null;
    metadata: Record<string, unknown>;
  }>;
};

export function normalizeSocialCandidate(
  candidate: SocialCandidate,
  productId: string,
  now = new Date(),
): NormalizedCandidate {
  const canonicalUrl = canonicalizeUrl(candidate.canonicalUrl);
  const recencyDays = candidate.publishedAt
    ? Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(candidate.publishedAt).getTime()) / 86_400_000,
        ),
      )
    : null;
  return {
    ...candidate,
    canonicalUrl,
    dedupeKey: buildSocialDedupeKey(productId, canonicalUrl, candidate.externalId),
    recencyDays,
    evidence: [
      {
        url: canonicalUrl,
        excerpt: candidate.excerpt,
        sourceType: candidate.sourceType,
        observedAt: candidate.publishedAt ?? null,
        metadata: candidate.metadata,
      },
    ],
  };
}

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/$/, '');
}

export function buildSocialDedupeKey(
  productId: string,
  canonicalUrl: string,
  externalId?: string,
): string {
  return `${SALES_OS_TENANT_ID}:${productId}:social:${externalId || canonicalUrl}`;
}

export type QualificationInput = {
  candidate: NormalizedCandidate;
  audienceStatus: 'proposed' | 'approved' | 'active' | 'paused' | 'rejected';
  routeStatus: 'proposed' | 'approved' | 'active' | 'paused' | 'rejected';
  signalStatus: 'active' | 'paused';
  sourceEnabled: boolean;
  duplicateExists: boolean;
  priorOpportunityStatus?: string | null;
  minimumEvidenceScore?: EvidenceScore;
};

export type QualificationDecision = {
  qualified: boolean;
  reason: string | null;
  evidenceScore: EvidenceScore;
  evidenceScoreDetail: EvidenceScoreDetail;
};

const scoreRank: Record<EvidenceScore, number> = { low: 0, medium: 1, high: 2 };

export function qualifySocialCandidate(
  input: QualificationInput,
): QualificationDecision {
  const detail = scoreEvidence({
    evidenceCount: input.candidate.evidence.length,
    sourceDiversity: new Set(
      input.candidate.evidence.map((evidence) => evidence.sourceType),
    ).size,
    signalSpecificity: input.candidate.signalSpecificity,
    recencyDays: input.candidate.recencyDays,
  });
  const minimum = input.minimumEvidenceScore ?? 'medium';
  const checks: Array<[boolean, string]> = [
    [
      Boolean(input.candidate.canonicalUrl && input.candidate.excerpt),
      'required_evidence_missing',
    ],
    [input.sourceEnabled, 'source_disabled'],
    [['approved', 'active'].includes(input.audienceStatus), 'audience_not_active'],
    [['approved', 'active'].includes(input.routeStatus), 'route_not_active'],
    [input.signalStatus === 'active', 'signal_paused'],
    [!input.duplicateExists, 'duplicate_opportunity'],
    [
      !['closed', 'rejected'].includes(input.priorOpportunityStatus ?? ''),
      'prior_opportunity_ineligible',
    ],
    [scoreRank[detail.score] >= scoreRank[minimum], 'evidence_score_below_threshold'],
  ];
  const failed = checks.find(([passed]) => !passed);
  return {
    qualified: !failed,
    reason: failed?.[1] ?? null,
    evidenceScore: detail.score,
    evidenceScoreDetail: detail.detail,
  };
}

export function buildSourceInsert(input: {
  productId: string;
  providerId?: string;
  candidate: NormalizedCandidate;
  actor: string;
}) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    provider_id: input.providerId ?? null,
    source_type: input.candidate.sourceType,
    name: input.candidate.sourceName,
    url: input.candidate.canonicalUrl,
    external_id: input.candidate.externalId ?? null,
    metadata: {
      ...input.candidate.metadata,
      authorIdentifier: input.candidate.authorIdentifier ?? null,
      publishedAt: input.candidate.publishedAt ?? null,
    },
    created_by: input.actor,
    updated_by: input.actor,
  };
}

export function buildOpportunityInsert(input: {
  productId: string;
  audienceId: string;
  sourceId: string;
  signalId?: string;
  routeType: 'social';
  candidate: NormalizedCandidate;
  qualification: QualificationDecision;
  aiFitAssessment: string;
  recommendedAction: string;
  actor: string;
}) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    audience_id: input.audienceId,
    route_type: input.routeType,
    source_id: input.sourceId,
    signal_id: input.signalId ?? null,
    title: input.candidate.title,
    summary: input.candidate.excerpt,
    evidence: input.candidate.evidence,
    evidence_score: input.qualification.evidenceScore,
    evidence_score_detail: input.qualification.evidenceScoreDetail,
    ai_fit_assessment: input.aiFitAssessment,
    recommended_action: input.recommendedAction,
    status: 'awaiting_review',
    discovered_at: input.candidate.publishedAt ?? new Date().toISOString(),
    dedupe_key: input.candidate.dedupeKey,
    first_touch_dimensions: { sourceType: input.candidate.sourceType },
    created_by: input.actor,
    updated_by: input.actor,
    state_changed_by: input.actor,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

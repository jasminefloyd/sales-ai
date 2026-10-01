import { z } from 'zod';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import {
  scoreEvidence,
  type EvidenceScore,
  type EvidenceScoreDetail,
} from '../evidence/scoring';
import { isSuppressed } from '../contacts/suppression';
import {
  hasDuplicateContact,
  hasDuplicateOpportunity,
  normalizeContactEmail,
} from './dedupe';

export const DirectAccountCandidateSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  websiteUrl: z.string().url(),
  industry: z.string().optional(),
  companyContext: z.record(z.string(), z.unknown()).default({}),
  evidence: z
    .array(
      z.object({
        url: z.string().url().optional(),
        excerpt: z.string().min(1),
        sourceType: z.string().min(1),
      }),
    )
    .min(1),
});

export const DirectPersonCandidateSchema = z.object({
  fullName: z.string().min(1),
  title: z.string().optional(),
  professionalProfileUrl: z.string().url().optional(),
  evidence: z
    .array(
      z.object({
        url: z.string().url().optional(),
        excerpt: z.string().min(1),
        sourceType: z.string().min(1),
      }),
    )
    .min(1),
});

export const DirectContactCandidateSchema = z.object({
  professionalEmail: z.string().email().optional(),
  verificationStatus: z.enum(['unknown', 'valid', 'risky', 'invalid']),
  verificationProvider: z.string().optional(),
  evidence: z
    .array(
      z.object({
        url: z.string().url().optional(),
        excerpt: z.string().min(1),
        sourceType: z.string().min(1),
      }),
    )
    .default([]),
});

export type DirectAccountCandidate = z.infer<typeof DirectAccountCandidateSchema>;
export type DirectPersonCandidate = z.infer<typeof DirectPersonCandidateSchema>;
export type DirectContactCandidate = z.infer<typeof DirectContactCandidateSchema>;

export function normalizeCompanyDomain(value: string): string {
  const withProtocol = value.includes('://') ? value : `https://${value}`;
  const url = new URL(withProtocol);
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

export function normalizeDirectEmail(value: string): string {
  return normalizeContactEmail(value);
}

export function buildDirectAccountInsert(input: {
  productId: string;
  candidate: DirectAccountCandidate;
  jobId: string;
  provider: string;
  actor: string;
}) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    name: input.candidate.name,
    domain: normalizeCompanyDomain(input.candidate.domain),
    website_url: input.candidate.websiteUrl,
    industry: input.candidate.industry ?? null,
    company_context: input.candidate.companyContext,
    source_evidence: input.candidate.evidence.map((evidence) => ({
      ...evidence,
      jobId: input.jobId,
      provider: input.provider,
      stage: 'account_discovery',
    })),
    created_by: input.actor,
    updated_by: input.actor,
  };
}

export function buildDirectContactInsert(input: {
  productId: string;
  accountId: string;
  person: DirectPersonCandidate;
  contact?: DirectContactCandidate;
  jobId: string;
  provider: string;
  actor: string;
}) {
  const contact = input.contact;
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    account_id: input.accountId,
    full_name: input.person.fullName,
    title: input.person.title ?? null,
    professional_profile_url: input.person.professionalProfileUrl ?? null,
    professional_email: contact?.professionalEmail
      ? normalizeDirectEmail(contact.professionalEmail)
      : null,
    email_verification_status: contact?.verificationStatus ?? 'unknown',
    email_verification_provider: contact?.verificationProvider ?? null,
    source_evidence: [...input.person.evidence, ...(contact?.evidence ?? [])].map(
      (evidence) => ({
        ...evidence,
        jobId: input.jobId,
        provider: input.provider,
        stage: contact ? 'contact_enrichment' : 'person_discovery',
      }),
    ),
    last_verified_at:
      contact?.verificationStatus && contact.verificationStatus !== 'unknown'
        ? new Date().toISOString()
        : null,
    created_by: input.actor,
    updated_by: input.actor,
  };
}

export type DirectQualificationInput = {
  productId: string;
  audienceStatus: 'proposed' | 'approved' | 'active' | 'paused' | 'rejected';
  routeStatus: 'proposed' | 'approved' | 'active' | 'paused' | 'rejected';
  account: DirectAccountCandidate;
  person: DirectPersonCandidate;
  contact?: DirectContactCandidate;
  duplicateContact: boolean;
  duplicateOpportunity: boolean;
  suppressed: boolean;
  minimumEvidenceScore?: EvidenceScore;
};

export type DirectQualificationDecision = {
  qualified: boolean;
  reason: string | null;
  evidenceScore: EvidenceScore;
  evidenceScoreDetail: EvidenceScoreDetail;
  emailReady: boolean;
};

const scoreRank: Record<EvidenceScore, number> = { low: 0, medium: 1, high: 2 };

export function qualifyDirectCandidate(
  input: DirectQualificationInput,
): DirectQualificationDecision {
  const evidence = [
    ...input.account.evidence,
    ...input.person.evidence,
    ...(input.contact?.evidence ?? []),
  ];
  const score = scoreEvidence({
    evidenceCount: evidence.length,
    sourceDiversity: new Set(evidence.map((item) => item.sourceType)).size,
    signalSpecificity: input.contact?.verificationStatus === 'valid' ? 1 : 0.75,
    recencyDays: 0,
  });
  const minimum = input.minimumEvidenceScore ?? 'medium';
  const checks: Array<[boolean, string]> = [
    [
      input.account.evidence.length > 0 && input.person.evidence.length > 0,
      'required_evidence_missing',
    ],
    [['approved', 'active'].includes(input.audienceStatus), 'audience_not_active'],
    [['approved', 'active'].includes(input.routeStatus), 'route_not_active'],
    [!input.duplicateContact, 'duplicate_contact'],
    [!input.duplicateOpportunity, 'duplicate_opportunity'],
    [!input.suppressed, 'contact_suppressed'],
    [scoreRank[score.score] >= scoreRank[minimum], 'evidence_score_below_threshold'],
  ];
  const failed = checks.find(([passed]) => !passed);
  return {
    qualified: !failed,
    reason: failed?.[1] ?? null,
    evidenceScore: score.score,
    evidenceScoreDetail: score.detail,
    emailReady: input.contact?.verificationStatus === 'valid',
  };
}

export function buildDirectOpportunityInsert(input: {
  productId: string;
  audienceId: string;
  sourceId: string;
  signalId?: string;
  accountId: string;
  contactId: string;
  account: DirectAccountCandidate;
  person: DirectPersonCandidate;
  contact?: DirectContactCandidate;
  qualification: DirectQualificationDecision;
  aiFitAssessment: string;
  recommendedAction: string;
  actor: string;
}) {
  const email = input.contact?.professionalEmail
    ? normalizeDirectEmail(input.contact.professionalEmail)
    : 'no-email';
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    audience_id: input.audienceId,
    route_type: 'direct',
    source_id: input.sourceId,
    signal_id: input.signalId ?? null,
    account_id: input.accountId,
    contact_id: input.contactId,
    title: `${input.person.fullName} at ${input.account.name}`,
    summary: `${input.person.title ?? 'Relevant contact'} at ${input.account.name} matches the selected organizational audience.`,
    evidence: [
      ...input.account.evidence,
      ...input.person.evidence,
      ...(input.contact?.evidence ?? []),
    ],
    evidence_score: input.qualification.evidenceScore,
    evidence_score_detail: input.qualification.evidenceScoreDetail,
    ai_fit_assessment: input.aiFitAssessment,
    recommended_action: input.recommendedAction,
    status: 'awaiting_review',
    dedupe_key: `${SALES_OS_TENANT_ID}:${input.productId}:direct:${input.account.domain}:${email}`,
    first_touch_dimensions: {
      routeType: 'direct',
      emailReady: input.qualification.emailReady,
    },
    created_by: input.actor,
    updated_by: input.actor,
    state_changed_by: input.actor,
  };
}

export { hasDuplicateContact, hasDuplicateOpportunity, isSuppressed };

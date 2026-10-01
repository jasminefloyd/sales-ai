import { z } from 'zod';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const JsonObject = z.record(z.string(), z.unknown());
const Provenance = z.array(z.unknown());

export const AudienceDefinitionSchema = z.object({
  productId: Uuid,
  icpId: Uuid,
  audienceId: Uuid,
  version: z.number().int().positive(),
  definitionKind: z.enum(['rule', 'snapshot', 'manual']),
  name: z.string().min(1),
  description: z.string(),
  ruleDefinition: JsonObject,
  sourceSystem: z.string().min(1),
  sourceRecordId: z.string().min(1).nullable().optional(),
  firstSeenAt: Timestamp.optional(),
  lastSeenAt: Timestamp.optional(),
  freshnessAt: Timestamp.optional(),
  confidence: z.number().min(0).max(1),
  provenance: Provenance,
  consentState: z.enum(['unknown', 'permitted', 'restricted', 'revoked']),
  status: z.enum(['draft', 'proposed', 'approved', 'active', 'paused', 'archived']),
});

export const AudienceMemberSchema = z
  .object({
    productId: Uuid,
    icpId: Uuid,
    audienceId: Uuid,
    definitionId: Uuid,
    accountId: Uuid.nullable().optional(),
    contactId: Uuid.nullable().optional(),
    identityType: z.enum(['company', 'person', 'pseudonymous', 'other']),
    externalEntityKey: z.string().min(1).nullable().optional(),
    sourceSystem: z.string().min(1),
    sourceRecordId: z.string().min(1).nullable().optional(),
    firstSeenAt: Timestamp.optional(),
    lastSeenAt: Timestamp.optional(),
    freshnessAt: Timestamp.optional(),
    confidence: z.number().min(0).max(1),
    provenance: Provenance,
    consentState: z.enum(['unknown', 'permitted', 'restricted', 'revoked']),
    suppressionState: z.enum(['not_checked', 'clear', 'suppressed']),
    status: z.enum([
      'discovered',
      'needs_enrichment',
      'ready',
      'stale',
      'low_confidence',
      'suppressed',
      'blocked',
      'removed',
    ]),
  })
  .superRefine((value, context) => {
    const identityCount =
      Number(Boolean(value.accountId)) +
      Number(Boolean(value.contactId)) +
      Number(Boolean(value.externalEntityKey?.trim()));
    if (identityCount !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['accountId'],
        message:
          'An audience member must link to exactly one account, contact, or external entity.',
      });
    }
  });

export const IdentityCandidateSchema = z
  .object({
    productId: Uuid,
    memberId: Uuid,
    candidateAccountId: Uuid.nullable().optional(),
    candidateContactId: Uuid.nullable().optional(),
    candidateExternalKey: z.string().min(1).nullable().optional(),
    candidateType: z.enum(['company', 'person', 'pseudonymous', 'other']),
    confidence: z.number().min(0).max(1),
    matchBasis: JsonObject,
    provenance: Provenance,
    status: z.enum(['pending', 'accepted', 'rejected', 'expired']),
  })
  .refine(
    (value) =>
      Number(Boolean(value.candidateAccountId)) +
        Number(Boolean(value.candidateContactId)) +
        Number(Boolean(value.candidateExternalKey?.trim())) >=
      1,
    {
      message:
        'An identity candidate must identify an account, contact, or external entity.',
    },
  );

export const IdentityMergeSchema = z
  .object({
    productId: Uuid,
    memberId: Uuid,
    candidateId: Uuid.nullable().optional(),
    sourceAccountId: Uuid.nullable().optional(),
    sourceContactId: Uuid.nullable().optional(),
    targetAccountId: Uuid.nullable().optional(),
    targetContactId: Uuid.nullable().optional(),
    confidence: z.number().min(0).max(1),
    mergeBasis: JsonObject,
    provenance: Provenance,
    status: z.enum(['pending', 'approved', 'rejected', 'reverted']),
  })
  .superRefine((value, context) => {
    if (
      Number(Boolean(value.sourceAccountId)) +
        Number(Boolean(value.sourceContactId)) !==
      1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAccountId'],
        message: 'An identity merge requires exactly one source account or contact.',
      });
    }
    if (
      Number(Boolean(value.targetAccountId)) +
        Number(Boolean(value.targetContactId)) !==
      1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetAccountId'],
        message: 'An identity merge requires exactly one target account or contact.',
      });
    }
  });

export const EnrichmentRecordSchema = z.object({
  productId: Uuid,
  memberId: Uuid,
  accountId: Uuid.nullable().optional(),
  contactId: Uuid.nullable().optional(),
  entityType: z.enum(['company', 'contact']),
  providerId: Uuid.nullable().optional(),
  providerCapability: z.string().min(1),
  sourceRecordId: z.string().min(1).nullable().optional(),
  status: z.enum(['requested', 'succeeded', 'partial', 'failed', 'stale']),
  data: JsonObject,
  provenance: Provenance,
  confidence: z.number().min(0).max(1),
  observedAt: Timestamp.optional(),
  freshnessAt: Timestamp.optional(),
  expiresAt: Timestamp.nullable().optional(),
  requestReference: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorDetail: z.string().nullable().optional(),
  retryable: z.boolean(),
});

export const QualitySnapshotSchema = z.object({
  productId: Uuid,
  definitionId: Uuid,
  memberId: Uuid,
  strategicFitScore: z.number().min(0).max(1).nullable().optional(),
  identityConfidenceScore: z.number().min(0).max(1).nullable().optional(),
  contactVerificationScore: z.number().min(0).max(1).nullable().optional(),
  freshnessScore: z.number().min(0).max(1).nullable().optional(),
  qualityScore: z.number().min(0).max(1).nullable().optional(),
  readinessState: z.enum([
    'ready',
    'needs_enrichment',
    'stale',
    'low_confidence',
    'suppressed',
    'blocked',
  ]),
  reasons: Provenance,
  calculatedAt: Timestamp.optional(),
  calculationVersion: z.string().min(1),
  isCurrent: z.boolean(),
});

export const IntentScoreSchema = z.object({
  productId: Uuid,
  icpId: Uuid,
  audienceId: Uuid,
  memberId: Uuid,
  signalId: Uuid.nullable().optional(),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  signalType: z.string().min(1),
  explanation: z.string().min(1),
  evidence: Provenance,
  scoreVersion: z.string().min(1),
  scoredAt: Timestamp.optional(),
  expiresAt: Timestamp.nullable().optional(),
});

export const AudienceActivationSchema = z.object({
  productId: Uuid,
  icpId: Uuid,
  audienceId: Uuid,
  definitionId: Uuid,
  destinationType: z.enum(['csv', 'webhook', 'crm']),
  destinationName: z.string().min(1),
  destinationConfig: JsonObject,
  memberFilter: JsonObject,
  status: z.enum([
    'draft',
    'pending_approval',
    'approved',
    'syncing',
    'completed',
    'failed',
    'cancelled',
  ]),
  approvalId: Uuid.nullable().optional(),
});

export const ActivationRecordSchema = z.object({
  productId: Uuid,
  activationId: Uuid,
  memberId: Uuid,
  destinationRecordId: z.string().nullable().optional(),
  payloadHash: z.string().nullable().optional(),
  status: z.enum(['pending', 'synced', 'failed', 'suppressed', 'removed']),
  suppressionState: z.enum(['clear', 'suppressed', 'unknown']),
  syncedAt: Timestamp.nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorDetail: z.string().nullable().optional(),
});

export const ActivationSyncRunSchema = z.object({
  productId: Uuid,
  activationId: Uuid,
  runType: z.enum(['full', 'incremental', 'retry']),
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled']),
  idempotencyKey: z.string().min(1),
  cursor: z.string().nullable().optional(),
  totalCount: z.number().int().nonnegative(),
  syncedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  suppressedCount: z.number().int().nonnegative(),
});

export type AudienceDefinitionInput = z.infer<typeof AudienceDefinitionSchema>;
export type AudienceMemberInput = z.infer<typeof AudienceMemberSchema>;
export type IdentityCandidateInput = z.infer<typeof IdentityCandidateSchema>;
export type IdentityMergeInput = z.infer<typeof IdentityMergeSchema>;
export type EnrichmentRecordInput = z.infer<typeof EnrichmentRecordSchema>;
export type QualitySnapshotInput = z.infer<typeof QualitySnapshotSchema>;
export type IntentScoreInput = z.infer<typeof IntentScoreSchema>;
export type AudienceActivationInput = z.infer<typeof AudienceActivationSchema>;
export type ActivationRecordInput = z.infer<typeof ActivationRecordSchema>;
export type ActivationSyncRunInput = z.infer<typeof ActivationSyncRunSchema>;

export function buildAudienceDefinitionInsert(
  input: AudienceDefinitionInput,
  actor: string,
) {
  const value = AudienceDefinitionSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    icp_id: value.icpId,
    audience_id: value.audienceId,
    version: value.version,
    definition_kind: value.definitionKind,
    name: value.name,
    description: value.description,
    rule_definition: value.ruleDefinition,
    source_system: value.sourceSystem,
    source_record_id: value.sourceRecordId ?? null,
    first_seen_at: value.firstSeenAt ?? new Date().toISOString(),
    last_seen_at: value.lastSeenAt ?? new Date().toISOString(),
    freshness_at: value.freshnessAt ?? new Date().toISOString(),
    confidence: value.confidence,
    provenance: value.provenance,
    consent_state: value.consentState,
    status: value.status,
    created_by: actor,
    updated_by: actor,
  };
}

export function buildAudienceMemberInsert(input: AudienceMemberInput, actor: string) {
  const value = AudienceMemberSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    icp_id: value.icpId,
    audience_id: value.audienceId,
    definition_id: value.definitionId,
    account_id: value.accountId ?? null,
    contact_id: value.contactId ?? null,
    identity_type: value.identityType,
    external_entity_key: value.externalEntityKey ?? null,
    source_system: value.sourceSystem,
    source_record_id: value.sourceRecordId ?? null,
    first_seen_at: value.firstSeenAt ?? new Date().toISOString(),
    last_seen_at: value.lastSeenAt ?? new Date().toISOString(),
    freshness_at: value.freshnessAt ?? new Date().toISOString(),
    confidence: value.confidence,
    provenance: value.provenance,
    consent_state: value.consentState,
    suppression_state: value.suppressionState,
    status: value.status,
    created_by: actor,
    updated_by: actor,
  };
}

export function buildIdentityCandidateInsert(
  input: IdentityCandidateInput,
  actor: string,
) {
  const value = IdentityCandidateSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    member_id: value.memberId,
    candidate_account_id: value.candidateAccountId ?? null,
    candidate_contact_id: value.candidateContactId ?? null,
    candidate_external_key: value.candidateExternalKey ?? null,
    candidate_type: value.candidateType,
    confidence: value.confidence,
    match_basis: value.matchBasis,
    provenance: value.provenance,
    status: value.status,
    created_by: actor,
    updated_by: actor,
  };
}

export function buildIdentityMergeInsert(input: IdentityMergeInput, actor: string) {
  const value = IdentityMergeSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    member_id: value.memberId,
    candidate_id: value.candidateId ?? null,
    source_account_id: value.sourceAccountId ?? null,
    source_contact_id: value.sourceContactId ?? null,
    target_account_id: value.targetAccountId ?? null,
    target_contact_id: value.targetContactId ?? null,
    confidence: value.confidence,
    merge_basis: value.mergeBasis,
    provenance: value.provenance,
    status: value.status,
    created_by: actor,
    updated_by: actor,
  };
}

export function buildEnrichmentRecordInsert(
  input: EnrichmentRecordInput,
  actor: string,
) {
  const value = EnrichmentRecordSchema.parse(input);
  if (Number(Boolean(value.accountId)) + Number(Boolean(value.contactId)) !== 1) {
    throw new Error('An enrichment record requires exactly one account or contact.');
  }
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    member_id: value.memberId,
    account_id: value.accountId ?? null,
    contact_id: value.contactId ?? null,
    entity_type: value.entityType,
    provider_id: value.providerId ?? null,
    provider_capability: value.providerCapability,
    source_record_id: value.sourceRecordId ?? null,
    status: value.status,
    data: value.data,
    provenance: value.provenance,
    confidence: value.confidence,
    observed_at: value.observedAt ?? new Date().toISOString(),
    freshness_at: value.freshnessAt ?? new Date().toISOString(),
    expires_at: value.expiresAt ?? null,
    request_reference: value.requestReference ?? null,
    error_code: value.errorCode ?? null,
    error_detail: value.errorDetail ?? null,
    retryable: value.retryable,
    created_by: actor,
    updated_by: actor,
  };
}

export function buildQualitySnapshotInsert(input: QualitySnapshotInput, actor: string) {
  const value = QualitySnapshotSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    definition_id: value.definitionId,
    member_id: value.memberId,
    strategic_fit_score: value.strategicFitScore ?? null,
    identity_confidence_score: value.identityConfidenceScore ?? null,
    contact_verification_score: value.contactVerificationScore ?? null,
    freshness_score: value.freshnessScore ?? null,
    quality_score: value.qualityScore ?? null,
    readiness_state: value.readinessState,
    reasons: value.reasons,
    calculated_at: value.calculatedAt ?? new Date().toISOString(),
    calculation_version: value.calculationVersion,
    is_current: value.isCurrent,
    created_by: actor,
  };
}

export function buildIntentScoreInsert(input: IntentScoreInput, actor: string) {
  const value = IntentScoreSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    icp_id: value.icpId,
    audience_id: value.audienceId,
    member_id: value.memberId,
    signal_id: value.signalId ?? null,
    score: value.score,
    confidence: value.confidence,
    signal_type: value.signalType,
    explanation: value.explanation,
    evidence: value.evidence,
    score_version: value.scoreVersion,
    scored_at: value.scoredAt ?? new Date().toISOString(),
    expires_at: value.expiresAt ?? null,
    created_by: actor,
  };
}

export function buildAudienceActivationInsert(
  input: AudienceActivationInput,
  actor: string,
) {
  const value = AudienceActivationSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    icp_id: value.icpId,
    audience_id: value.audienceId,
    definition_id: value.definitionId,
    destination_type: value.destinationType,
    destination_name: value.destinationName,
    destination_config: value.destinationConfig,
    member_filter: value.memberFilter,
    status: value.status,
    approval_id: value.approvalId ?? null,
    created_by: actor,
    updated_by: actor,
  };
}

export function buildActivationRecordInsert(
  input: ActivationRecordInput,
  actor: string,
) {
  const value = ActivationRecordSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    activation_id: value.activationId,
    member_id: value.memberId,
    destination_record_id: value.destinationRecordId ?? null,
    payload_hash: value.payloadHash ?? null,
    status: value.status,
    suppression_state: value.suppressionState,
    synced_at: value.syncedAt ?? null,
    error_code: value.errorCode ?? null,
    error_detail: value.errorDetail ?? null,
    created_by: actor,
    updated_by: actor,
  };
}

export function buildActivationSyncRunInsert(
  input: ActivationSyncRunInput,
  actor: string,
) {
  const value = ActivationSyncRunSchema.parse(input);
  return {
    id: crypto.randomUUID(),
    tenant_id: SALES_OS_TENANT_ID,
    product_id: value.productId,
    activation_id: value.activationId,
    run_type: value.runType,
    status: value.status,
    idempotency_key: value.idempotencyKey,
    cursor: value.cursor ?? null,
    total_count: value.totalCount,
    synced_count: value.syncedCount,
    failed_count: value.failedCount,
    suppressed_count: value.suppressedCount,
    created_by: actor,
    updated_by: actor,
  };
}

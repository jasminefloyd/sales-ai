import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildActivationRecordInsert,
  buildActivationSyncRunInsert,
  buildAudienceActivationInsert,
  buildAudienceDefinitionInsert,
  buildAudienceMemberInsert,
  buildEnrichmentRecordInsert,
  buildIdentityCandidateInsert,
  buildIdentityMergeInsert,
  buildIntentScoreInsert,
  buildQualitySnapshotInsert,
  type ActivationRecordInput,
  type ActivationSyncRunInput,
  type AudienceActivationInput,
  type AudienceDefinitionInput,
  type AudienceMemberInput,
  type EnrichmentRecordInput,
  type IdentityCandidateInput,
  type IdentityMergeInput,
  type IntentScoreInput,
  type QualitySnapshotInput,
} from './intelligenceContracts';

async function insertOne<T extends Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  value: T,
) {
  const { data, error } = await client.from(table).insert(value).select().single();
  if (error) throw error;
  return data;
}

export async function persistAudienceDefinition(
  client: SupabaseClient,
  input: AudienceDefinitionInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_audience_definitions',
    buildAudienceDefinitionInsert(input, actor),
  );
}

/**
 * Members are intentionally inserted by stable source identifiers in the
 * orchestration layer. This helper does not use an upsert against the partial
 * source index, avoiding ambiguous ON CONFLICT behavior across Postgres versions.
 */
export async function persistAudienceMember(
  client: SupabaseClient,
  input: AudienceMemberInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_audience_members',
    buildAudienceMemberInsert(input, actor),
  );
}

export async function listAudienceMembers(
  client: SupabaseClient,
  productId: string,
  definitionId: string,
) {
  const { data, error } = await client
    .from('sales_os_audience_members')
    .select('*')
    .eq('tenant_id', 'sales_os')
    .eq('product_id', productId)
    .eq('definition_id', definitionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function persistIdentityCandidate(
  client: SupabaseClient,
  input: IdentityCandidateInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_identity_candidates',
    buildIdentityCandidateInsert(input, actor),
  );
}

export async function persistIdentityMerge(
  client: SupabaseClient,
  input: IdentityMergeInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_identity_merges',
    buildIdentityMergeInsert(input, actor),
  );
}

export async function persistEnrichmentRecord(
  client: SupabaseClient,
  input: EnrichmentRecordInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_enrichment_records',
    buildEnrichmentRecordInsert(input, actor),
  );
}

export async function persistQualitySnapshot(
  client: SupabaseClient,
  input: QualitySnapshotInput,
  actor: string,
) {
  if (input.isCurrent) {
    const { error } = await client
      .from('sales_os_audience_quality_snapshots')
      .update({ is_current: false })
      .eq('tenant_id', 'sales_os')
      .eq('member_id', input.memberId)
      .eq('is_current', true);
    if (error) throw error;
  }
  return insertOne(
    client,
    'sales_os_audience_quality_snapshots',
    buildQualitySnapshotInsert(input, actor),
  );
}

export async function persistIntentScore(
  client: SupabaseClient,
  input: IntentScoreInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_intent_scores',
    buildIntentScoreInsert(input, actor),
  );
}

export async function persistAudienceActivation(
  client: SupabaseClient,
  input: AudienceActivationInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_audience_activations',
    buildAudienceActivationInsert(input, actor),
  );
}

export async function persistActivationRecord(
  client: SupabaseClient,
  input: ActivationRecordInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_activation_records',
    buildActivationRecordInsert(input, actor),
  );
}

export async function persistActivationSyncRun(
  client: SupabaseClient,
  input: ActivationSyncRunInput,
  actor: string,
) {
  return insertOne(
    client,
    'sales_os_activation_sync_runs',
    buildActivationSyncRunInsert(input, actor),
  );
}

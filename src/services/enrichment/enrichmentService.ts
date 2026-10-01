import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import { buildJobIdempotencyKey, persistJob } from '../jobs/jobService';

export type EnrichmentStatus =
  'not_started' | 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'stale';

export type EnrichmentEntity = {
  enrichment_status?: EnrichmentStatus | null;
  last_enriched_at?: string | null;
  enrichment_error?: string | null;
};

export type EnrichmentSnapshot = {
  missingFields: string[];
  stale: boolean;
  activationReady: boolean;
  reasons: string[];
};

const DEFAULT_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

export function isFresh(
  lastEnrichedAt: string | null | undefined,
  freshnessAt?: string | null,
  now = Date.now(),
) {
  const until = freshnessAt ? Date.parse(freshnessAt) : NaN;
  if (Number.isFinite(until)) return until > now;
  const observed = lastEnrichedAt ? Date.parse(lastEnrichedAt) : NaN;
  return Number.isFinite(observed) && observed + DEFAULT_FRESHNESS_MS > now;
}

export function missingCompanyFields(value: {
  name?: string | null;
  domain?: string | null;
  website_url?: string | null;
  industry?: string | null;
}) {
  return [
    ['name', value.name],
    ['domain', value.domain],
    ['website_url', value.website_url],
    ['industry', value.industry],
  ]
    .filter(([, field]) => !String(field ?? '').trim())
    .map(([field]) => String(field));
}

export function missingContactFields(value: {
  full_name?: string | null;
  title?: string | null;
  professional_email?: string | null;
  email_verification_status?: string | null;
}) {
  const missing = [
    ['full_name', value.full_name],
    ['title', value.title],
    ['professional_email', value.professional_email],
  ]
    .filter(([, field]) => !String(field ?? '').trim())
    .map(([field]) => String(field));
  if (String(value.email_verification_status ?? '').toLowerCase() !== 'valid')
    missing.push('verified_email');
  return missing;
}

export function buildEnrichmentSnapshot(input: {
  entity: 'company' | 'contact';
  record: Record<string, unknown>;
  memberStatus?: string | null;
  consentState?: string | null;
  suppressionState?: string | null;
  freshnessAt?: string | null;
  now?: number;
}): EnrichmentSnapshot {
  const missingFields =
    input.entity === 'company'
      ? missingCompanyFields(input.record as never)
      : missingContactFields(input.record as never);
  const stale = !isFresh(
    typeof input.record.last_enriched_at === 'string'
      ? input.record.last_enriched_at
      : null,
    input.freshnessAt,
    input.now,
  );
  const reasons: string[] = [];
  if (stale) reasons.push('enrichment is missing or stale');
  if (missingFields.length) reasons.push(`missing: ${missingFields.join(', ')}`);
  if (input.consentState === 'restricted' || input.consentState === 'revoked')
    reasons.push('consent does not permit activation');
  if (input.suppressionState === 'suppressed') reasons.push('suppressed');
  if (input.memberStatus === 'removed' || input.memberStatus === 'blocked')
    reasons.push(`member is ${input.memberStatus}`);
  const activationReady =
    input.entity === 'contact' &&
    missingFields.length === 0 &&
    input.consentState !== 'restricted' &&
    input.consentState !== 'revoked' &&
    input.suppressionState !== 'suppressed' &&
    !['removed', 'blocked'].includes(String(input.memberStatus ?? ''));
  return { missingFields, stale, activationReady, reasons };
}

export function mergeNonEmptyFields<T extends Record<string, unknown>>(
  existing: T,
  incoming: Record<string, unknown>,
) {
  const merged = { ...existing } as T;
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    merged[key as keyof T] = value as T[keyof T];
  }
  return merged;
}

export async function queueAudienceEnrichment(
  client: SupabaseClient,
  input: {
    productId: string;
    audienceId: string;
    definitionId: string;
    actor: string;
    scope?: string;
  },
) {
  return persistJob(client, {
    productId: input.productId,
    jobType: 'audience_enrichment',
    payload: {
      audienceId: input.audienceId,
      definitionId: input.definitionId,
      mode: 'approved_b2b_audience',
    },
    actor: input.actor,
    idempotencyKey: buildJobIdempotencyKey({
      productId: input.productId,
      jobType: 'audience_enrichment',
      scope: input.scope ?? `${input.audienceId}:${input.definitionId}`,
    }),
    estimatedCost: 0,
    maxAttempts: 3,
  });
}

export async function retryAudienceEnrichment(
  client: SupabaseClient,
  input: { productId: string; audienceId: string; actor: string },
) {
  const { data: audience, error: audienceError } = await client
    .from('sales_os_audiences')
    .select('status')
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('product_id', input.productId)
    .eq('id', input.audienceId)
    .single();
  if (audienceError) throw audienceError;
  if (!['approved', 'active'].includes(String(audience.status))) {
    throw new Error('Approve this audience before retrying enrichment.');
  }

  const { count: memberCount, error: memberError } = await client
    .from('sales_os_audience_members')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('product_id', input.productId)
    .eq('audience_id', input.audienceId)
    .not('status', 'in', '(removed,suppressed,blocked)');
  if (memberError) throw memberError;
  if ((memberCount ?? 0) === 0) {
    throw new Error(
      'No audience members are available for enrichment yet. Approve an outreach route and run discovery first.',
    );
  }

  const { data: definition, error } = await client
    .from('sales_os_audience_definitions')
    .select('id')
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('product_id', input.productId)
    .eq('audience_id', input.audienceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!definition) throw new Error('This audience has no enrichment definition yet.');
  return queueAudienceEnrichment(client, {
    ...input,
    definitionId: definition.id,
    scope: `${input.audienceId}:manual:${Date.now()}`,
  });
}

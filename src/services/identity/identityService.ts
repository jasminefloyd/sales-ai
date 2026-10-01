import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';

export const IDENTITY_AUTO_LINK_THRESHOLD = 0.95;
export const IDENTITY_REVIEW_THRESHOLD = 0.65;

export function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function normalizePhone(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizeDomain(value: string | null | undefined) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(
      /^www\./,
      '',
    );
  } catch {
    return raw.replace(/^www\./, '').split('/')[0];
  }
}

export function normalizeName(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizedTokens(value: string | null | undefined) {
  return normalizeName(value).split(' ').filter(Boolean);
}

export function similarity(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const a = new Set(normalizedTokens(left));
  const b = new Set(normalizedTokens(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

export type IdentityCandidate = {
  candidateAccountId?: string | null;
  candidateContactId?: string | null;
  candidateExternalKey?: string | null;
  candidateType: 'company' | 'person' | 'pseudonymous' | 'other';
  confidence: number;
  matchBasis: Record<string, unknown>;
  matchType: 'deterministic' | 'candidate';
};

export function resolveAccountMatch(input: {
  domain?: string | null;
  crmRecordId?: string | null;
  providerRecordId?: string | null;
  candidates: Array<{
    id: string;
    domain?: string | null;
    crm_record_id?: string | null;
    provider_record_id?: string | null;
  }>;
}): IdentityCandidate | null {
  const domain = normalizeDomain(input.domain);
  const exact = input.candidates.find(
    (candidate) =>
      (input.crmRecordId && candidate.crm_record_id === input.crmRecordId) ||
      (input.providerRecordId &&
        candidate.provider_record_id === input.providerRecordId) ||
      (domain && normalizeDomain(candidate.domain) === domain),
  );
  if (exact)
    return {
      candidateAccountId: exact.id,
      candidateType: 'company',
      confidence: 1,
      matchBasis: { deterministic: true, domain },
      matchType: 'deterministic',
    };
  return null;
}

export function resolveContactMatch(input: {
  email?: string | null;
  phone?: string | null;
  crmRecordId?: string | null;
  providerRecordId?: string | null;
  fullName?: string | null;
  title?: string | null;
  candidates: Array<{
    id: string;
    normalized_email?: string | null;
    normalized_phone?: string | null;
    crm_record_id?: string | null;
    provider_record_id?: string | null;
    full_name?: string | null;
    title?: string | null;
  }>;
}): IdentityCandidate | null {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const exact = input.candidates.find(
    (candidate) =>
      (email && candidate.normalized_email === email) ||
      (phone && candidate.normalized_phone === phone) ||
      (input.crmRecordId && candidate.crm_record_id === input.crmRecordId) ||
      (input.providerRecordId &&
        candidate.provider_record_id === input.providerRecordId),
  );
  if (exact)
    return {
      candidateContactId: exact.id,
      candidateType: 'person',
      confidence: 1,
      matchBasis: { deterministic: true, email: Boolean(email), phone: Boolean(phone) },
      matchType: 'deterministic',
    };
  const possible = input.candidates
    .map((candidate) => ({
      candidate,
      name: similarity(input.fullName, candidate.full_name),
      title: similarity(input.title, candidate.title),
    }))
    .map((item) => ({ ...item, confidence: item.name * 0.75 + item.title * 0.25 }))
    .sort((left, right) => right.confidence - left.confidence)[0];
  if (!possible || possible.confidence < IDENTITY_REVIEW_THRESHOLD) return null;
  return {
    candidateContactId: possible.candidate.id,
    candidateType: 'person',
    confidence: possible.confidence,
    matchBasis: { nameSimilarity: possible.name, titleSimilarity: possible.title },
    matchType: 'candidate',
  };
}

export function canAutoLink(candidate: IdentityCandidate) {
  return (
    candidate.matchType === 'deterministic' &&
    candidate.confidence >= IDENTITY_AUTO_LINK_THRESHOLD
  );
}

export async function createIdentityCandidate(
  client: SupabaseClient,
  input: {
    productId: string;
    memberId: string;
    candidate: IdentityCandidate;
    actor: string;
    provenance?: unknown[];
  },
) {
  const { data, error } = await client
    .from('sales_os_identity_candidates')
    .insert({
      tenant_id: SALES_OS_TENANT_ID,
      product_id: input.productId,
      member_id: input.memberId,
      candidate_account_id: input.candidate.candidateAccountId ?? null,
      candidate_contact_id: input.candidate.candidateContactId ?? null,
      candidate_external_key: input.candidate.candidateExternalKey ?? null,
      candidate_type: input.candidate.candidateType,
      confidence: input.candidate.confidence,
      match_basis: input.candidate.matchBasis,
      provenance: input.provenance ?? [],
      match_type: input.candidate.matchType,
      status: input.candidate.matchType === 'deterministic' ? 'accepted' : 'pending',
      reviewed_by: input.candidate.matchType === 'deterministic' ? input.actor : null,
      reviewed_at:
        input.candidate.matchType === 'deterministic' ? new Date().toISOString() : null,
      created_by: input.actor,
      updated_by: input.actor,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

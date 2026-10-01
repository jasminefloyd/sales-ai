import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import type { AdminAnalyticsEventName, AdminAnalyticsSource } from './eventCatalog';

const ANONYMOUS_ID_KEY = 'sales_os_analytics_anonymous_id';
const SESSION_ID_KEY = 'sales_os_analytics_session_id';
const UTM_KEY = 'sales_os_analytics_utm';
const ATTRIBUTION_KEY = 'sales_os_analytics_sales_attribution';

type StoredUtm = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
};

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function randomId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? Math.random().toString(36).slice(2)}`;
}

function getOrCreate(key: string, prefix: string): string {
  const storage = browserStorage();
  if (!storage) return randomId(prefix);
  const existing = storage.getItem(key);
  if (existing) return existing;
  const value = randomId(prefix);
  storage.setItem(key, value);
  return value;
}

function readStoredUtm(): StoredUtm {
  const storage = browserStorage();
  if (!storage) return { source: null, medium: null, campaign: null, content: null };
  try {
    return JSON.parse(storage.getItem(UTM_KEY) ?? '{}') as StoredUtm;
  } catch {
    return { source: null, medium: null, campaign: null, content: null };
  }
}

function captureLocationContext(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const storage = browserStorage();
  if (!storage) return;
  const current = readStoredUtm();
  const next = {
    source: params.get('utm_source') ?? current.source,
    medium: params.get('utm_medium') ?? current.medium,
    campaign: params.get('utm_campaign') ?? current.campaign,
    content: params.get('utm_content') ?? current.content,
  };
  storage.setItem(UTM_KEY, JSON.stringify(next));
  const attribution = params.get('sales_attribution_id');
  if (attribution) storage.setItem(ATTRIBUTION_KEY, attribution);
}

export function initializeAnalyticsIdentity(): void {
  captureLocationContext();
  getOrCreate(ANONYMOUS_ID_KEY, 'anon');
  getOrCreate(SESSION_ID_KEY, 'session');
}

export function rememberSalesAttributionId(value: string | null | undefined): void {
  if (!value) return;
  browserStorage()?.setItem(ATTRIBUTION_KEY, value);
}

export async function linkAnalyticsIdentity(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const identity = getAnalyticsIdentity();
  if (!identity.anonymousId) return;
  await track(
    client,
    'identity_linked',
    {
      anonymous_id: identity.anonymousId,
      sales_attribution_id: identity.salesAttributionId,
    },
    {
      userId,
      idempotencyKey: `identity-link:${identity.anonymousId}:${userId}`,
    },
  );
}

export function getAnalyticsIdentity() {
  initializeAnalyticsIdentity();
  const storage = browserStorage();
  const utm = readStoredUtm();
  return {
    anonymousId: storage?.getItem(ANONYMOUS_ID_KEY) ?? null,
    sessionId: storage?.getItem(SESSION_ID_KEY) ?? null,
    salesAttributionId: storage?.getItem(ATTRIBUTION_KEY) ?? null,
    utm,
  };
}

export async function track(
  client: SupabaseClient,
  eventName: AdminAnalyticsEventName,
  properties: Record<string, unknown> = {},
  input: {
    productId?: string;
    userId?: string | null;
    source?: AdminAnalyticsSource;
    salesOpportunityId?: string | null;
    salesEngagementId?: string | null;
    idempotencyKey?: string;
    isInternal?: boolean;
  } = {},
) {
  const identity = getAnalyticsIdentity();
  const event = {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId ?? null,
    event_name: eventName,
    occurred_at: new Date().toISOString(),
    user_id: input.userId ?? null,
    anonymous_id: identity.anonymousId,
    session_id: identity.sessionId,
    properties,
    source: input.source ?? 'web',
    page_url: typeof window === 'undefined' ? null : window.location.href,
    referrer: typeof document === 'undefined' ? null : document.referrer || null,
    utm_source: identity.utm.source,
    utm_medium: identity.utm.medium,
    utm_campaign: identity.utm.campaign,
    utm_content: identity.utm.content,
    sales_attribution_id: identity.salesAttributionId,
    sales_opportunity_id: input.salesOpportunityId ?? null,
    sales_engagement_id: input.salesEngagementId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    is_internal: input.isInternal ?? false,
  };
  const { error } = input.idempotencyKey
    ? await client.from('sales_os_admin_events').upsert(event, {
        onConflict: 'tenant_id,idempotency_key',
        ignoreDuplicates: true,
      })
    : await client.from('sales_os_admin_events').insert(event);
  if (error) throw error;
  return { eventName, idempotencyKey: input.idempotencyKey ?? null };
}

export function buildServerEventInsert(input: {
  productId: string;
  eventName: AdminAnalyticsEventName;
  occurredAt?: string;
  userId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  properties?: Record<string, unknown>;
  source: Exclude<AdminAnalyticsSource, 'web'>;
  salesAttributionId?: string | null;
  salesOpportunityId?: string | null;
  salesEngagementId?: string | null;
  idempotencyKey: string;
  isInternal?: boolean;
}) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    event_name: input.eventName,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    user_id: input.userId ?? null,
    anonymous_id: input.anonymousId ?? null,
    session_id: input.sessionId ?? null,
    properties: input.properties ?? {},
    source: input.source,
    sales_attribution_id: input.salesAttributionId ?? null,
    sales_opportunity_id: input.salesOpportunityId ?? null,
    sales_engagement_id: input.salesEngagementId ?? null,
    idempotency_key: input.idempotencyKey,
    is_internal: input.isInternal ?? false,
  };
}

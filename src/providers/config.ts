import type { SupabaseClient } from '@supabase/supabase-js';

import {
  communityAdapter,
  exaAdapter,
  firecrawlAdapter,
  gmailAdapter,
  hunterAdapter,
  openAiAdapter,
  anthropicAdapter,
} from './adapters';
import type { CapabilityName, CapabilityProvider } from './capabilities';
import { ProviderRegistry } from './registry';
import {
  IntelligenceCapabilitySchema,
  type IntelligenceCapability,
} from './intelligenceContracts';
import { IntelligenceProviderRegistry } from './intelligenceRegistry';
import { createLegacyIntelligenceAdapter } from './adapters/legacyIntelligence';

const adapters: Record<string, CapabilityProvider> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
  exa: exaAdapter,
  firecrawl: firecrawlAdapter,
  hunter: hunterAdapter,
  gmail: gmailAdapter,
  community: communityAdapter,
  reddit_web: communityAdapter,
};

type ProviderRow = {
  id: string;
  provider_key: string;
  capability: CapabilityName;
  enabled: boolean;
  priority: number;
};

type IntelligenceProviderRow = Omit<ProviderRow, 'capability'> & {
  capability: string;
  health_status?: 'unknown' | 'healthy' | 'degraded' | 'unavailable';
  timeout_ms?: number;
};

export function buildProviderRegistry(rows: readonly ProviderRow[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const row of rows) {
    const adapter = adapters[row.provider_key];
    if (!adapter || !adapter.capabilities.includes(row.capability)) continue;
    registry.register({
      providerId: row.id,
      provider: adapter,
      capability: row.capability,
      enabled: row.enabled,
      qualified: true,
      priority: row.priority,
    });
  }
  return registry;
}

export async function loadProviderRegistry(
  client: SupabaseClient,
): Promise<ProviderRegistry> {
  const { data, error } = await client
    .from('sales_os_providers')
    .select('id, provider_key, capability, enabled, priority')
    .eq('tenant_id', 'sales_os')
    .order('priority', { ascending: true });
  if (error) throw error;
  return buildProviderRegistry((data ?? []) as ProviderRow[]);
}

const legacyCapabilityNames: Partial<Record<CapabilityName, IntelligenceCapability>> = {
  findCompany: 'find_company',
  findContact: 'find_contact',
  verifyContact: 'verify_email',
};

export function buildIntelligenceProviderRegistry(
  rows: readonly IntelligenceProviderRow[],
): IntelligenceProviderRegistry {
  const registry = new IntelligenceProviderRegistry();
  for (const row of rows) {
    const adapter = adapters[row.provider_key];
    const capability = IntelligenceCapabilitySchema.safeParse(row.capability).success
      ? (row.capability as IntelligenceCapability)
      : legacyCapabilityNames[row.capability as CapabilityName];
    if (!adapter || !capability) continue;
    const legacyCapability =
      Object.entries(legacyCapabilityNames).find(
        ([, value]) => value === capability,
      )?.[0] ?? capability;
    if (!adapter.capabilities.includes(legacyCapability as CapabilityName)) continue;
    registry.register({
      providerId: row.id,
      provider: createLegacyIntelligenceAdapter(adapter, [capability]),
      capability,
      enabled: row.enabled,
      qualified: true,
      healthStatus: row.health_status ?? 'unknown',
      priority: row.priority,
      timeoutMs: row.timeout_ms ?? 30000,
    });
  }
  return registry;
}

export async function loadIntelligenceProviderRegistry(
  client: SupabaseClient,
): Promise<IntelligenceProviderRegistry> {
  const { data, error } = await client
    .from('sales_os_providers')
    .select(
      'id, provider_key, capability, enabled, priority, health_status, timeout_ms',
    )
    .eq('tenant_id', 'sales_os')
    .order('priority', { ascending: true });
  if (error) throw error;
  return buildIntelligenceProviderRegistry((data ?? []) as IntelligenceProviderRow[]);
}

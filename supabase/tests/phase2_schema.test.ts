import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260922001000_sales_os_canonical_state.sql',
  ),
  'utf8',
);

const tables = [
  'sales_os_products',
  'sales_os_product_profiles',
  'sales_os_audiences',
  'sales_os_audience_routes',
  'sales_os_sources',
  'sales_os_signals',
  'sales_os_accounts',
  'sales_os_contacts',
  'sales_os_opportunities',
  'sales_os_engagements',
  'sales_os_conversations',
  'sales_os_suppression_records',
  'sales_os_approvals',
  'sales_os_events',
  'sales_os_conversions',
  'sales_os_learnings',
  'sales_os_providers',
  'sales_os_provider_runs',
  'sales_os_jobs',
];

describe('Sales OS Phase 2 schema contract', () => {
  it('defines every canonical V1 table with a tenant constraint', () => {
    for (const table of tables) {
      expect(migration).toContain(`create table public.${table}`);
      const tableStart = migration.indexOf(`create table public.${table}`);
      const tableEnd = migration.indexOf(');', tableStart);
      const definition = migration.slice(tableStart, tableEnd);
      expect(definition).toContain("tenant_id text not null default 'sales_os'");
      expect(definition).toContain("check (tenant_id = 'sales_os')");
    }
  });

  it('defines RLS, immutable events, and centralized transition enforcement', () => {
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('sales_os_events_immutable');
    expect(migration).toContain('sales_os_validate_transition');
    expect(migration).toContain('sales_os_validate_state_transition');
  });
});

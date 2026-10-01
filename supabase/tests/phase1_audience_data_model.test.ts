import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260928010000_sales_os_phase_01_audience_data_model.sql',
  ),
  'utf8',
);

const tables = [
  'sales_os_audience_definitions',
  'sales_os_audience_members',
  'sales_os_identity_candidates',
  'sales_os_identity_merges',
  'sales_os_enrichment_records',
  'sales_os_audience_quality_snapshots',
  'sales_os_intent_scores',
  'sales_os_audience_activations',
  'sales_os_activation_records',
  'sales_os_activation_sync_runs',
];

describe('Sales OS Phase 1 audience data model contract', () => {
  it('defines every canonical audience-intelligence object with tenant scoping', () => {
    for (const table of tables) {
      expect(migration).toContain(`create table if not exists public.${table}`);
    }
    expect(migration).toContain(
      "execute format('alter table public.%I enable row level security', table_name)",
    );
    expect(migration).toContain(
      'foreign key (tenant_id, product_id)\n    references public.sales_os_products',
    );
  });

  it('keeps member identities explicit and supports operational relationships', () => {
    expect(migration).toContain('foreign key (tenant_id, account_id)');
    expect(migration).toContain('foreign key (tenant_id, contact_id)');
    expect(migration).toContain('external_entity_key');
    expect(migration).toContain('num_nonnulls(account_id, contact_id)');
    expect(migration).toContain('source_system, source_record_id');
    expect(migration).toContain('freshness_at');
    expect(migration).toContain('provenance jsonb');
  });

  it('adds versioned quality, intent, and activation persistence with idempotency keys', () => {
    expect(migration).toContain('calculation_version text not null');
    expect(migration).toContain('score_version text not null');
    expect(migration).toContain('idempotency_key text not null');
    expect(migration).toContain('unique (tenant_id, activation_id, member_id)');
    expect(migration).toContain('unique (tenant_id, activation_id, idempotency_key)');
    expect(migration).toContain('where is_current');
  });
});

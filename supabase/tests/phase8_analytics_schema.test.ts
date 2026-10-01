import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260929080000_sales_os_phase_08_audience_analytics.sql',
  ),
  'utf8',
);

describe('Sales OS Phase 8 analytics schema contract', () => {
  it('indexes the full audience lifecycle and activation reconciliation paths', () => {
    expect(migration).toContain('sales_os_events_audience_lifecycle_idx');
    expect(migration).toContain('sales_os_events_signal_provider_idx');
    expect(migration).toContain('sales_os_activation_records_analytics_idx');
    expect(migration).toContain('sales_os_activation_sync_runs_analytics_idx');
  });

  it('instruments discovery, enrichment, identity, quality, activation, sync, and provider events', () => {
    expect(migration).toContain('audience_member_discovered');
    expect(migration).toContain('audience_member_enriched');
    expect(migration).toContain('identity_resolved');
    expect(migration).toContain('audience_member_ready');
    expect(migration).toContain('activation_sync_reconciled');
    expect(migration).toContain('provider_run_succeeded');
    expect(migration).toContain(
      'on conflict (tenant_id, product_id, idempotency_key) do nothing',
    );
  });
});

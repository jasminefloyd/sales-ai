import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260928030000_sales_os_phase_03_enrichment.sql',
  ),
  'utf8',
);

describe('Sales OS Phase 3 enrichment contract', () => {
  it('adds an explicit enrichment job type and operational entity states', () => {
    expect(migration).toContain("'audience_enrichment'");
    expect(migration).toContain('sales_os_accounts');
    expect(migration).toContain('enrichment_status text not null default');
    expect(migration).toContain('last_enriched_at timestamptz');
  });

  it('records attempts, missing fields, job identity, completion, and latency', () => {
    expect(migration).toContain('job_id uuid');
    expect(migration).toContain('attempt integer not null default');
    expect(migration).toContain('missing_fields jsonb not null default');
    expect(migration).toContain('latency_ms integer');
    expect(migration).toContain('completed_at timestamptz');
  });

  it('maps enrichment into existing workflow telemetry', () => {
    expect(migration).toContain("when 'audience_enrichment' then 'diagnostics'");
  });
});

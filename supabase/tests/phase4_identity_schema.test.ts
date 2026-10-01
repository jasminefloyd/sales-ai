import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260928040000_sales_os_phase_04_identity_resolution.sql',
  ),
  'utf8',
);

describe('Sales OS Phase 4 identity schema contract', () => {
  it('adds deterministic identity keys and merge state', () => {
    expect(migration).toContain('normalized_phone text generated always as');
    expect(migration).toContain('crm_record_id text');
    expect(migration).toContain('provider_record_id text');
    expect(migration).toContain("identity_state text not null default 'canonical'");
  });

  it('stores reversible merge snapshots and conflict decisions', () => {
    expect(migration).toContain('source_snapshot jsonb not null default');
    expect(migration).toContain('target_snapshot jsonb not null default');
    expect(migration).toContain('conflict_resolution jsonb not null default');
    expect(migration).toContain('reverted_reason text');
  });

  it('adds scoped lookup and review indexes', () => {
    expect(migration).toContain('sales_os_contacts_identity_lookup_idx');
    expect(migration).toContain('sales_os_identity_candidates_review_idx');
    expect(migration).toContain('sales_os_identity_merges_key_unique');
  });
});

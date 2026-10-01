import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260928020000_sales_os_phase_02_provider_contracts.sql',
  ),
  'utf8',
);

describe('Sales OS Phase 2 provider contract migration', () => {
  it('adds non-secret health and timeout metadata to provider registrations', () => {
    expect(migration).toContain('health_status text not null default');
    expect(migration).toContain('timeout_ms integer not null default');
    expect(migration).toContain('failure_count integer not null default');
    expect(migration).toContain('health_metadata jsonb not null default');
  });

  it('records retry, fallback, request identity, and provenance on provider runs', () => {
    expect(migration).toContain('retryable boolean');
    expect(migration).toContain('fallback_used boolean not null default false');
    expect(migration).toContain('request_hash text');
    expect(migration).toContain('provenance jsonb not null default');
  });
});

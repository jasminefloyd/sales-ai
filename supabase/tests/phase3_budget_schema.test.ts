import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260922002000_sales_os_provider_guardrails.sql',
  ),
  'utf8',
);

describe('Sales OS Phase 3 budget schema contract', () => {
  it('defines a tenant-scoped reservation table and budget RPC', () => {
    expect(migration).toContain('create table public.sales_os_budget_reservations');
    expect(migration).toContain("tenant_id text not null default 'sales_os'");
    expect(migration).toContain(
      'create or replace function public.sales_os_check_budget',
    );
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('monthly_cap_exceeded');
    expect(migration).toContain('per_run_cap_exceeded');
  });
});

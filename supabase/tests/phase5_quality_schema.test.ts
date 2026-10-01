import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260928050000_sales_os_phase_05_quality_freshness.sql',
  ),
  'utf8',
);

describe('Sales OS Phase 5 quality schema contract', () => {
  it('adds quality recalculation jobs, audience state, and rollups', () => {
    expect(migration).toContain("'audience_quality'");
    expect(migration).toContain('quality_state text not null default');
    expect(migration).toContain(
      'create table if not exists public.sales_os_audience_quality_rollups',
    );
    expect(migration).toContain('ready_count integer');
    expect(migration).toContain('stale_count integer');
    expect(migration).toContain('missing_data_count integer');
  });

  it('defines a hard activation-readiness gate', () => {
    expect(migration).toContain('sales_os_member_activation_ready');
    expect(migration).toContain("contact.email_verification_status = 'valid'");
    expect(migration).toContain("member.suppression_state = 'clear'");
    expect(migration).toContain("quality.readiness_state = 'ready'");
  });
});

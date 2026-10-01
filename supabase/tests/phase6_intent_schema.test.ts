import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260928060000_sales_os_phase_06_intent_scoring.sql',
  ),
  'utf8',
);

describe('Sales OS Phase 6 intent schema contract', () => {
  it('defines normalized signal taxonomy and intent history fields', () => {
    expect(migration).toContain(
      'create table if not exists public.sales_os_signal_taxonomy',
    );
    expect(migration).toContain('normalized_signal_type text');
    expect(migration).toContain('recency_window_days');
    expect(migration).toContain('frequency_boost');
    expect(migration).toContain('score_explanation jsonb');
    expect(migration).toContain('raw_score numeric');
    expect(migration).toContain('override_reason text');
  });

  it('adds the intent worker stage and human override audit fields', () => {
    expect(migration).toContain("'audience_intent'");
    expect(migration).toContain("when 'audience_intent' then 'find'");
    expect(migration).toContain('updated_by text');
    expect(migration).toContain('sales_os_intent_scores_current_idx');
  });
});

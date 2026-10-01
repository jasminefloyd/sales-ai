import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260930070000_sales_os_intent_score_tenant_repair.sql',
  ),
  'utf8',
);

describe('intent score tenant repair', () => {
  it('coalesces explicit null tenant values to the single Sales OS tenant', () => {
    expect(migration).toContain("coalesce(new.tenant_id, 'sales_os')");
    expect(migration).toContain('before insert on public.sales_os_intent_scores');
  });
});

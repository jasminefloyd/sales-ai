import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260930010000_sales_os_display_labels.sql',
  ),
  'utf8',
);
describe('display label schema contract', () => {
  it('adds optional UI labels without changing canonical fields', () => {
    for (const table of [
      'sales_os_product_profiles',
      'sales_os_icps',
      'sales_os_audiences',
      'sales_os_outreach_decisions',
    ]) {
      expect(migration).toContain(`alter table public.${table}`);
      expect(migration).toContain(
        'add column if not exists display_labels jsonb not null default',
      );
    }
  });
});

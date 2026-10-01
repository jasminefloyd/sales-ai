import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260930060000_sales_os_updated_at_trigger_repair.sql',
  ),
  'utf8',
);

describe('updated_at trigger repair', () => {
  it('does not directly dereference NEW.updated_at', () => {
    expect(migration).not.toContain('new.updated_at = now()');
    expect(migration).toContain("to_jsonb(new) ? 'updated_at'");
    expect(migration).toContain('jsonb_populate_record');
  });

  it('removes stale timestamp triggers from tables without updated_at', () => {
    expect(migration).toContain('information_schema.columns');
    expect(migration).toContain("not has_updated_at");
    expect(migration).toContain('drop trigger if exists');
  });
});

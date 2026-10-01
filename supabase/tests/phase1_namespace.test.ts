import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDirectory = resolve(process.cwd(), 'supabase/migrations');

function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => resolve(migrationsDirectory, file));
}

describe('Sales OS migration namespace contract', () => {
  it('rejects unprefixed Sales OS-owned tables and functions', () => {
    const sql = migrationFiles()
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const ownedTableStatements = [
      ...sql.matchAll(
        /create\s+(?:or\s+replace\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi,
      ),
    ];
    const ownedFunctionStatements = [
      ...sql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)/gi,
      ),
    ];

    expect(
      ownedTableStatements.every((match) => match[1].startsWith('sales_os_')),
    ).toBe(true);
    expect(
      ownedFunctionStatements.every((match) => match[1].startsWith('sales_os_')),
    ).toBe(true);
  });

  it('keeps the Phase 1 tenant helper fixed to sales_os', () => {
    const sql = readFileSync(
      resolve(migrationsDirectory, '20260922000000_sales_os_phase1_foundation.sql'),
      'utf8',
    );
    expect(sql).toContain('public.sales_os_assert_tenant');
    expect(sql).toContain("p_tenant_id is distinct from 'sales_os'");
  });
});

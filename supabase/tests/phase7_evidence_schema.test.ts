import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260928070000_sales_os_phase_07_evidence_explanations.sql',
  ),
  'utf8',
);
const documentRepair = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260929130000_sales_os_phase_07_document_evidence_mapping.sql',
  ),
  'utf8',
);

describe('Sales OS Phase 7 evidence schema contract', () => {
  it('stores append-only evidence snapshots across material subjects', () => {
    expect(migration).toContain(
      'create table if not exists public.sales_os_evidence_records',
    );
    expect(migration).toContain('subject_type text not null');
    expect(migration).toContain('source_snippet text');
    expect(migration).toContain('snapshot jsonb not null');
    expect(migration).toContain("'insufficient'");
    expect(migration).toContain('content_hash text not null');
  });

  it('captures evidence and explicit gaps for every material recommendation', () => {
    expect(migration).toContain('sales_os_capture_evidence_snapshot');
    expect(migration).toContain('Insufficient evidence: no persisted source evidence');
    expect(migration).toContain(
      'create trigger sales_os_capture_evidence_%s after insert or update',
    );
    expect(migration).toContain('Content hashes make this backfill safe to rerun');
  });

  it('preserves document source references and qualitative excerpts', () => {
    expect(documentRepair).toContain("item->>'source'");
    expect(documentRepair).toContain("item->>'relevance'");
    expect(documentRepair).toContain('source_reference');
  });
});

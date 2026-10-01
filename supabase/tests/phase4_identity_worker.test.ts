import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const worker = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/workerAnalysis.ts'),
  'utf8',
);
const reviewFunction = readFileSync(
  resolve(process.cwd(), 'supabase/functions/sales_os-review-identity/index.ts'),
  'utf8',
);

describe('Sales OS Phase 4 identity wiring', () => {
  it('records uncertain contact matches as review candidates', () => {
    expect(worker).toContain('recordIdentityCandidatesForContact');
    expect(worker).toContain("from('sales_os_identity_candidates')");
    expect(worker).toContain("match_type: 'candidate'");
  });

  it('supports audited approve, reject, and reversible merge actions', () => {
    expect(reviewFunction).toContain("body.action === 'reject'");
    expect(reviewFunction).toContain("body.action === 'revert'");
    expect(reviewFunction).toContain("from('sales_os_identity_merges')");
    expect(reviewFunction).toContain("event_type: 'identity_merge'");
  });
});

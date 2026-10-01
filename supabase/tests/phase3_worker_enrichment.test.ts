import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const worker = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/workerAnalysis.ts'),
  'utf8',
);
const dispatcher = readFileSync(
  resolve(process.cwd(), 'supabase/functions/sales_os-worker/index.ts'),
  'utf8',
);

describe('Sales OS Phase 3 enrichment worker wiring', () => {
  it('enriches organizations before contacts and persists member records', () => {
    expect(worker).toContain('export async function enrichAudienceForWorker');
    expect(worker).toContain("'findCompany'");
    expect(worker).toContain("'findContact'");
    expect(worker).toContain("'verifyContact'");
    expect(worker).toContain("from('sales_os_enrichment_records')");
    expect(worker).toContain("from('sales_os_suppression_records')");
  });

  it('dispatches enrichment jobs and queues a post-find follow-up', () => {
    expect(dispatcher).toContain("job.job_type === 'audience_enrichment'");
    expect(dispatcher).toContain('queueFollowUpEnrichment');
  });
});

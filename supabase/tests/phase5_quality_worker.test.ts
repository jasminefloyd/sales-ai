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

describe('Sales OS Phase 5 quality worker wiring', () => {
  it('calculates member snapshots and audience rollups', () => {
    expect(worker).toContain('recalculateAudienceQualityForWorker');
    expect(worker).toContain("from('sales_os_audience_quality_snapshots')");
    expect(worker).toContain("from('sales_os_audience_quality_rollups')");
    expect(worker).toContain('qualityScoreWorker');
  });

  it('dispatches quality jobs after enrichment', () => {
    expect(dispatcher).toContain("job.job_type === 'audience_quality'");
    expect(dispatcher).toContain('queueFollowUpQuality');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const worker = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/workerAnalysis.ts'),
  'utf8',
);
const review = readFileSync(
  resolve(process.cwd(), 'supabase/functions/sales_os-review-audience/index.ts'),
  'utf8',
);
const page = readFileSync(
  resolve(process.cwd(), 'src/app/ProductWorkflowPage.tsx'),
  'utf8',
);

describe('B2B direct outreach workflow contract', () => {
  it('enforces a direct route for business audiences', () => {
    expect(worker).toContain('icp_strategy_enforced_direct_v1');
    expect(worker).toContain("routeType: 'direct'");
    expect(worker).toContain('runDirectFindForWorker');
  });

  it('queues discovery when a B2B audience is approved', () => {
    expect(review).toContain('approval_enforced_direct_v1');
    expect(review).toContain("job_type: 'find'");
    expect(review).toContain('findQueued');
  });

  it('surfaces route state and discovered targets in the product workflow', () => {
    expect(page).toContain("from('sales_os_audience_routes')");
    expect(page).toContain('Direct email route:');
    expect(page).toContain('Run direct discovery');
    expect(page).toContain('Named accounts and verified contacts discovered');
  });
});

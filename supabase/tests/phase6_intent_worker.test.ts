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
const review = readFileSync(
  resolve(process.cwd(), 'supabase/functions/sales_os-review-intent/index.ts'),
  'utf8',
);

describe('Sales OS Phase 6 intent worker wiring', () => {
  it('scores product, ICP, audience, signal, and member context deterministically', () => {
    expect(worker).toContain('scoreAudienceIntentForWorker');
    expect(worker).toContain('calculateIntentScoreWorker');
    expect(worker).toContain('recencyDecay');
    expect(worker).toContain('textOverlap');
    expect(worker).toContain("from('sales_os_intent_scores')");
    expect(worker).toContain("event_type: 'intent_scored'");
  });

  it('scopes every persisted intent score to the Sales OS tenant', () => {
    const insertStart = worker.indexOf(".from('sales_os_intent_scores')");
    const insertEnd = worker.indexOf(".select('id')", insertStart);
    const insertBlock = worker.slice(insertStart, insertEnd);
    expect(insertBlock).toContain('tenant_id: tenantId');
  });

  it('queues intent after quality and dispatches intent jobs', () => {
    expect(dispatcher).toContain('queueFollowUpIntent');
    expect(dispatcher).toContain("job.job_type === 'audience_intent'");
  });

  it('requires a human reason for score overrides', () => {
    expect(review).toContain("body.action === 'override'");
    expect(review).toContain('A reason is required for an intent override.');
    expect(review).toContain("event_type: 'intent_score_override'");
  });
});

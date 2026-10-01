import { describe, expect, it } from 'vitest';

import { presentWorkflowJob } from './workflowProgress';

describe('presentWorkflowJob', () => {
  it('does not expose technical job terminology for active work', () => {
    expect(
      presentWorkflowJob({ status: 'running', workflowState: 'generating_copy' }),
    ).toMatchObject({ label: 'In progress', actionable: false });
  });

  it('makes failures actionable', () => {
    expect(
      presentWorkflowJob({
        status: 'failed',
        workflowState: 'error',
        error: { reason: 'Provider unavailable' },
      }),
    ).toMatchObject({ label: 'Needs attention', actionable: true });
  });
});

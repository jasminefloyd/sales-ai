import { describe, expect, it } from 'vitest';

import { deriveProductWorkflowView } from './workflowState';

const base = {
  productStatus: 'active',
  hasInput: true,
  hasProfile: true,
  profileApproved: true,
};

describe('product workflow state', () => {
  it('requires product input before any downstream state', () => {
    expect(deriveProductWorkflowView({ ...base, hasInput: false }).state).toBe(
      'needs_input',
    );
  });

  it('shows importing and parsing as distinct states', () => {
    expect(
      deriveProductWorkflowView({ ...base, productStatus: 'draft', activeJobCount: 1 })
        .state,
    ).toBe('importing');
    expect(
      deriveProductWorkflowView({ ...base, productStatus: 'analyzing' }).state,
    ).toBe('parsing');
  });

  it('blocks strategy progression until the profile is approved', () => {
    expect(deriveProductWorkflowView({ ...base, profileApproved: false }).state).toBe(
      'profile_review',
    );
  });

  it('surfaces outreach review before copy generation', () => {
    expect(deriveProductWorkflowView({ ...base, proposedOutreachCount: 2 }).state).toBe(
      'outreach_review',
    );
    expect(deriveProductWorkflowView({ ...base, approvedOutreachCount: 1 }).state).toBe(
      'generating_copy',
    );
  });

  it('surfaces copy readiness and failures', () => {
    expect(deriveProductWorkflowView({ ...base, generatedCopyCount: 1 }).state).toBe(
      'copy_ready',
    );
    expect(deriveProductWorkflowView({ ...base, failedJobCount: 1 }).state).toBe(
      'error',
    );
  });
});

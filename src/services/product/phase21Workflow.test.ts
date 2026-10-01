import { describe, expect, it } from 'vitest';

import { deriveProductWorkflowView } from './workflowState';

describe('product-centered workflow contract', () => {
  it('moves through the user-facing sequence without exposing internal job stages', () => {
    const profileReview = deriveProductWorkflowView({
      productStatus: 'audience_review',
      hasInput: true,
      hasProfile: true,
      profileApproved: false,
    });
    expect(profileReview.state).toBe('profile_review');

    const outreachReview = deriveProductWorkflowView({
      productStatus: 'active',
      hasInput: true,
      hasProfile: true,
      profileApproved: true,
      proposedOutreachCount: 1,
    });
    expect(outreachReview.state).toBe('outreach_review');

    const copyReady = deriveProductWorkflowView({
      productStatus: 'active',
      hasInput: true,
      hasProfile: true,
      profileApproved: true,
      approvedOutreachCount: 1,
      generatedCopyCount: 1,
      pendingCopyApprovalCount: 1,
    });
    expect(copyReady.state).toBe('copy_ready');
  });
});

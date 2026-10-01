import { describe, expect, it } from 'vitest';

import { canScheduleFollowUp, shouldCancelFollowUp } from './followups';

describe('follow-up controls', () => {
  it('requires explicit approval and an executed prior engagement', () => {
    expect(
      canScheduleFollowUp({
        explicitApproval: true,
        priorEngagementStatus: 'executed',
        conversationStatus: 'waiting',
        replyDetected: false,
        suppressed: false,
      }).allowed,
    ).toBe(true);
    expect(
      canScheduleFollowUp({
        explicitApproval: false,
        priorEngagementStatus: 'executed',
        conversationStatus: 'waiting',
        replyDetected: false,
        suppressed: false,
      }).reason,
    ).toBe('explicit_approval_required');
  });
  it('cancels follow-up on reply or suppression', () => {
    expect(
      shouldCancelFollowUp({
        replyDetected: true,
        suppressed: false,
        conversationClosed: false,
      }),
    ).toBe(true);
    expect(
      shouldCancelFollowUp({
        replyDetected: false,
        suppressed: false,
        conversationClosed: false,
      }),
    ).toBe(false);
  });
});

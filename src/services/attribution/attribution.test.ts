import { describe, expect, it } from 'vitest';

import { calculateAttribution, conversionEventMatches } from './attribution';

describe('attribution', () => {
  it('preserves the earliest opportunity and selects the latest qualifying touch in-window', () => {
    const result = calculateAttribution(
      [
        {
          id: 'opportunity-early',
          event_type: 'opportunity_discovered',
          occurred_at: '2026-01-01T00:00:00.000Z',
          opportunity_id: 'opportunity-early',
          dimensions: { source: 'forum' },
        },
        {
          id: 'engagement-old',
          event_type: 'engagement_executed',
          occurred_at: '2025-12-01T00:00:00.000Z',
          engagement_id: 'engagement-old',
          dimensions: {},
        },
        {
          id: 'engagement-latest',
          event_type: 'response_received',
          occurred_at: '2026-01-20T00:00:00.000Z',
          engagement_id: 'engagement-latest',
          dimensions: { channel: 'email' },
        },
      ],
      '2026-01-25T00:00:00.000Z',
    );

    expect(result.firstTouch?.id).toBe('opportunity-early');
    expect(result.lastTouch?.id).toBe('engagement-latest');
  });

  it('only creates a configured product conversion event', () => {
    expect(
      conversionEventMatches({ eventName: 'trial_started' }, 'trial_started'),
    ).toBe(true);
    expect(conversionEventMatches({ eventName: 'trial_started' }, 'signup')).toBe(
      false,
    );
    expect(conversionEventMatches(undefined, 'signup')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { mapPostHogEvent } from './productEventMapping';

describe('PostHog product-event mapping', () => {
  it('maps only the configured activation event', () => {
    const event = {
      event: 'trial_started',
      distinct_id: 'customer-1',
      properties: { plan: 'pro' },
      timestamp: '2026-02-01T00:00:00.000Z',
    };
    expect(
      mapPostHogEvent(event, { eventName: 'trial_started', conversionType: 'trial' }),
    ).toEqual({
      eventType: 'trial_started',
      occurredAt: '2026-02-01T00:00:00.000Z',
      customerExternalId: 'customer-1',
      dimensions: {
        provider: 'posthog',
        properties: { plan: 'pro' },
        conversionType: 'trial',
      },
    });
    expect(
      mapPostHogEvent(event, { eventName: 'signup', conversionType: 'signup' }),
    ).toBeNull();
  });
});

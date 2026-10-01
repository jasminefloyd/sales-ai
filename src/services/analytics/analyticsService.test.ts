import { describe, expect, it } from 'vitest';

import { buildAnalyticsSnapshot } from './analyticsService';

describe('admin analytics aggregation', () => {
  it('builds product and Sales AI funnels from first-party records', () => {
    const snapshot = buildAnalyticsSnapshot({
      range: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z' },
      adminEvents: [
        {
          id: '1',
          event_name: 'product_visit',
          occurred_at: '2026-01-05T00:00:00.000Z',
          user_id: null,
          anonymous_id: 'anon-1',
          sales_attribution_id: 'attr-1',
          sales_opportunity_id: 'opp-1',
          sales_engagement_id: null,
          properties: {},
          is_internal: false,
        },
        {
          id: '2',
          event_name: 'user_signed_up',
          occurred_at: '2026-01-06T00:00:00.000Z',
          user_id: 'user-1',
          anonymous_id: 'anon-1',
          sales_attribution_id: 'attr-1',
          sales_opportunity_id: 'opp-1',
          sales_engagement_id: null,
          properties: {},
          is_internal: false,
        },
        {
          id: '3',
          event_name: 'pass_purchased',
          occurred_at: '2026-01-07T00:00:00.000Z',
          user_id: 'user-1',
          anonymous_id: 'anon-1',
          sales_attribution_id: 'attr-1',
          sales_opportunity_id: 'opp-1',
          sales_engagement_id: 'eng-1',
          properties: {},
          is_internal: false,
        },
      ],
      opportunities: [
        {
          id: 'opp-1',
          status: 'qualified',
          audience_id: 'aud-1',
          route_type: 'social',
          source_id: 'src-1',
          signal_id: null,
          discovered_at: '2026-01-05T00:00:00.000Z',
        },
      ],
      engagements: [
        {
          id: 'eng-1',
          opportunity_id: 'opp-1',
          status: 'executed',
          channel: 'email',
          message_angle: 'value',
          cta: 'demo',
        },
      ],
      salesEvents: [],
      conversions: [
        {
          conversion_type: 'purchase',
          value: 99,
          converted_at: '2026-01-07T00:00:00.000Z',
          first_touch_opportunity_id: 'opp-1',
          last_touch_engagement_id: 'eng-1',
        },
      ],
      providerRuns: [{ actual_cost: 12, estimated_cost: 10, status: 'succeeded' }],
    });

    expect(snapshot.overview).toMatchObject({
      visitors: 1,
      signups: 1,
      paidCustomers: 1,
      revenue: 99,
      salesOsSignups: 1,
      salesOsRevenue: 99,
      salesOsCost: 12,
    });
    expect(snapshot.productFunnel.map((step) => step.users)).toEqual([
      1, 1, 0, 0, 0, 0, 1,
    ]);
    expect(snapshot.breakdowns[0]).toMatchObject({
      opportunities: 1,
      engagements: 1,
      revenue: 99,
    });
  });

  it('excludes internal users and events outside the selected range', () => {
    const snapshot = buildAnalyticsSnapshot({
      range: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z' },
      adminEvents: [
        {
          id: '1',
          event_name: 'product_visit',
          occurred_at: '2025-12-31T00:00:00.000Z',
          user_id: 'user-1',
          anonymous_id: null,
          sales_attribution_id: null,
          sales_opportunity_id: null,
          sales_engagement_id: null,
          properties: {},
          is_internal: false,
        },
        {
          id: '2',
          event_name: 'product_visit',
          occurred_at: '2026-01-02T00:00:00.000Z',
          user_id: 'internal',
          anonymous_id: null,
          sales_attribution_id: null,
          sales_opportunity_id: null,
          sales_engagement_id: null,
          properties: {},
          is_internal: true,
        },
      ],
      opportunities: [],
      engagements: [],
      salesEvents: [],
      conversions: [],
      providerRuns: [],
    });
    expect(snapshot.overview.visitors).toBe(0);
  });
});

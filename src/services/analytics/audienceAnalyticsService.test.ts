import { describe, expect, it } from 'vitest';
import { buildAudienceAnalyticsSnapshot } from './audienceAnalyticsService';

const range = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' };

describe('audience analytics aggregation', () => {
  it('reconciles lifecycle stages and attribution without counting outside the range', () => {
    const snapshot = buildAudienceAnalyticsSnapshot({
      range,
      audiences: [{ id: 'a1', name: 'Primary', icp_id: 'i1' }],
      members: [
        {
          id: 'm1',
          audience_id: 'a1',
          account_id: 'ac1',
          contact_id: 'c1',
          status: 'ready',
          created_at: '2026-09-10T00:00:00.000Z',
        },
        {
          id: 'm2',
          audience_id: 'a1',
          account_id: null,
          contact_id: null,
          status: 'discovered',
          created_at: '2026-08-10T00:00:00.000Z',
        },
      ],
      enrichments: [
        {
          member_id: 'm1',
          status: 'succeeded',
          provider_id: 'p1',
          created_at: '2026-09-11T00:00:00.000Z',
        },
      ],
      contacts: [{ id: 'c1', email_verification_status: 'valid' }],
      quality: [],
      activationRecords: [
        {
          member_id: 'm1',
          activation_id: 'x1',
          status: 'synced',
          created_at: '2026-09-12T00:00:00.000Z',
        },
      ],
      syncRuns: [
        {
          activation_id: 'x1',
          status: 'completed',
          total_count: 1,
          synced_count: 1,
          failed_count: 0,
          created_at: '2026-09-12T00:00:00.000Z',
        },
      ],
      opportunities: [
        {
          id: 'o1',
          audience_id: 'a1',
          signal_id: 's1',
          status: 'qualified',
          discovered_at: '2026-09-13T00:00:00.000Z',
        },
      ],
      engagements: [
        {
          id: 'e1',
          opportunity_id: 'o1',
          status: 'executed',
          created_at: '2026-09-14T00:00:00.000Z',
        },
      ],
      events: [
        {
          event_type: 'intent_scored',
          signal_id: 's1',
          occurred_at: '2026-09-13T00:00:00.000Z',
        },
      ],
      conversions: [
        {
          value: 100,
          converted_at: '2026-09-15T00:00:00.000Z',
          first_touch_opportunity_id: 'o1',
          last_touch_engagement_id: 'e1',
        },
      ],
      providerRuns: [
        {
          provider_id: 'p1',
          status: 'succeeded',
          started_at: '2026-09-11T00:00:00.000Z',
          actual_cost: 2,
        },
      ],
      providers: [{ id: 'p1', provider_key: 'exa' }],
    });
    expect(snapshot.overview.discovered).toBe(1);
    expect(snapshot.overview.ready).toBe(1);
    expect(snapshot.overview.converted).toBe(1);
    expect(snapshot.attribution.firstTouchRevenue).toBe(100);
    expect(snapshot.signals[0]).toMatchObject({
      signalId: 's1',
      qualified: 1,
      converted: 1,
    });
  });

  it('does not create false conversions from a retried conversion row', () => {
    const snapshot = buildAudienceAnalyticsSnapshot({
      range,
      audiences: [],
      members: [],
      enrichments: [],
      contacts: [],
      quality: [],
      activationRecords: [],
      syncRuns: [],
      opportunities: [],
      engagements: [],
      events: [],
      conversions: [
        {
          value: 20,
          converted_at: '2026-09-10T00:00:00.000Z',
          first_touch_opportunity_id: 'o1',
          last_touch_engagement_id: 'e1',
        },
        {
          value: 20,
          converted_at: '2026-09-10T00:00:01.000Z',
          first_touch_opportunity_id: 'o1',
          last_touch_engagement_id: 'e1',
        },
      ],
      providerRuns: [],
      providers: [],
    });
    expect(snapshot.attribution.firstTouchConversions).toBe(1);
  });

  it('uses the explicit UTC range and keeps stage counts auditable', () => {
    const snapshot = buildAudienceAnalyticsSnapshot({
      range,
      audiences: [],
      members: [
        {
          id: 'm1',
          account_id: 'a1',
          status: 'ready',
          created_at: '2026-09-30T23:59:59.999Z',
        },
        { id: 'm2', status: 'ready', created_at: '2026-10-01T00:00:00.000Z' },
      ],
      enrichments: [
        {
          member_id: 'm1',
          status: 'succeeded',
          created_at: '2026-09-30T23:59:59.999Z',
        },
      ],
      contacts: [],
      quality: [],
      activationRecords: [],
      syncRuns: [],
      opportunities: [],
      engagements: [],
      events: [],
      conversions: [],
      providerRuns: [],
      providers: [],
    });
    expect(snapshot.overview.discovered).toBe(1);
    expect(snapshot.funnel.map((step) => step.count)).toEqual([
      1, 1, 1, 0, 1, 0, 0, 0, 0,
    ]);
  });
});

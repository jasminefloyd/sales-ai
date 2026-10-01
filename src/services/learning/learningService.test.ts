import { describe, expect, it } from 'vitest';

import { aggregateLearningMetrics, buildLearningProposal } from './learningService';

describe('learning service', () => {
  it('aggregates outcome dimensions without discarding provenance', () => {
    const metrics = aggregateLearningMetrics([
      {
        event_type: 'opportunity_discovered',
        audience_id: 'aud-1',
        dimensions: { route: 'social' },
      },
      {
        event_type: 'engagement_executed',
        engagement_id: 'eng-1',
        dimensions: { cta: 'demo' },
      },
    ]);
    expect(metrics.sampleSize).toBe(2);
    expect(metrics.byEventType.engagement_executed).toBe(1);
    expect(metrics.dimensions[1]?.values).toEqual({ cta: 'demo' });
    expect(metrics.breakdowns.cta.demo).toBe(1);
  });

  it('groups required learning dimensions deterministically', () => {
    const metrics = aggregateLearningMetrics([
      {
        event_type: 'engagement_executed',
        audience_id: 'a1',
        source_id: 's1',
        dimensions: { route: 'social', cta: 'trial', provider: 'reddit' },
      },
      {
        event_type: 'engagement_executed',
        audience_id: 'a1',
        source_id: 's1',
        dimensions: { route: 'social', cta: 'trial', provider: 'reddit' },
      },
    ]);
    expect(metrics.breakdowns.audience.a1).toBe(2);
    expect(metrics.breakdowns.route.social).toBe(2);
    expect(metrics.breakdowns.cta.trial).toBe(2);
    expect(metrics.breakdowns.provider.reddit).toBe(2);
  });

  it('creates only proposed, allowlisted learning changes', () => {
    const proposal = buildLearningProposal({
      productId: 'product-1',
      actor: 'user-1',
      recommendation: {
        observation: 'Demo CTA produced more responses.',
        supportingEvidence: [{ event: 'response_received' }],
        sampleSize: 12,
        confidence: 'medium',
        targetPhase: 'engage',
        recommendedChange: {
          targetKey: 'cta_preference',
          targetEntityId: null,
          before: 'Learn more',
          after: 'Book a demo',
        },
      },
    });
    expect(proposal.status).toBe('proposed');
    expect(proposal.target_entity_type).toBe('cta_preference');
  });
});

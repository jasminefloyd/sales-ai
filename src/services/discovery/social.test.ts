import { describe, expect, it } from 'vitest';

import {
  buildSocialSearchPlan,
  normalizeSocialCandidate,
  qualifySocialCandidate,
} from './social';

const candidate = normalizeSocialCandidate(
  {
    canonicalUrl: 'https://Example.com/post/1/#comment',
    title: 'Need a better workflow',
    excerpt: 'We are actively looking for a way to solve this problem.',
    sourceType: 'forum',
    sourceName: 'Example Forum',
    publishedAt: '2026-09-20T00:00:00.000Z',
    signalType: 'purchase_intent',
    signalSpecificity: 1,
    metadata: {},
  },
  'product-1',
  new Date('2026-09-22T00:00:00.000Z'),
);

describe('social discovery', () => {
  it('builds queries from canonical context without hard-coded terms', () => {
    const plan = buildSocialSearchPlan({
      productName: 'Product',
      productProfile: {
        problemsSolved: ['manual reporting'],
        primaryUseCases: ['weekly planning'],
        purchaseTriggers: ['new team'],
      },
      audience: {
        name: 'Growth leads',
        relevantTerminology: ['pipeline visibility'],
        purchaseTriggers: ['hiring'],
      },
      activeSignals: [
        { name: 'asking for recommendations', description: '', signalType: 'intent' },
      ],
    });
    expect(plan.queries).toContain('Growth leads manual reporting');
    expect(plan.contextVersion).toBe('social_search_plan_v1');
  });

  it('rejects disabled, duplicate, stale, and weak candidates deterministically', () => {
    const result = qualifySocialCandidate({
      candidate,
      audienceStatus: 'active',
      routeStatus: 'active',
      signalStatus: 'active',
      sourceEnabled: false,
      duplicateExists: false,
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('source_disabled');
  });

  it('preserves evidence and qualifies a valid candidate', () => {
    const result = qualifySocialCandidate({
      candidate,
      audienceStatus: 'approved',
      routeStatus: 'approved',
      signalStatus: 'active',
      sourceEnabled: true,
      duplicateExists: false,
      minimumEvidenceScore: 'low',
    });
    expect(result.qualified).toBe(true);
    expect(candidate.canonicalUrl).toBe('https://example.com/post/1');
    expect(result.evidenceScoreDetail.rubricVersion).toBe('evidence_v1');
  });
});

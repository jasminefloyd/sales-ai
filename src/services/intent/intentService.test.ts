import { describe, expect, it } from 'vitest';

import {
  calculateIntentScore,
  normalizeProviderSignal,
  normalizeSignalType,
} from './intentService';

describe('product-specific intent scoring', () => {
  it('normalizes provider signal vocabulary', () => {
    expect(normalizeSignalType('looking for a recommendation')).toBe(
      'request_for_solution',
    );
    expect(normalizeSignalType('competitor alternative')).toBe('competitor_reference');
    expect(
      normalizeProviderSignal({
        text: 'Need a rehearsal tool',
        signal_type: 'request',
      }),
    ).toMatchObject({
      signalType: 'request_for_solution',
      signalText: 'Need a rehearsal tool',
    });
  });

  it('scores the same signal differently for different product contexts', () => {
    const signal = {
      signalType: 'request_for_solution',
      signalText: 'Need an AI rehearsal platform for audition preparation',
      observedAt: new Date().toISOString(),
    };
    const match = calculateIntentScore({
      ...signal,
      productText: 'AI rehearsal platform audition preparation',
      icpText: 'actors preparing auditions',
      audienceText: 'actors needing rehearsal support',
      baseWeight: 0.9,
    });
    const mismatch = calculateIntentScore({
      ...signal,
      productText: 'enterprise accounting automation',
      icpText: 'finance executives',
      audienceText: 'accounting teams',
      baseWeight: 0.9,
    });
    expect(match.score).toBeGreaterThan(mismatch.score);
    expect(match.explanation).toHaveProperty('recencyDecay');
  });

  it('applies repeated-signal boosts and negative penalties deterministically', () => {
    const base = calculateIntentScore({
      productText: 'sales automation',
      icpText: 'sales leaders',
      audienceText: 'teams evaluating sales automation',
      signalType: 'request_for_solution',
      signalText: 'Need sales automation',
      frequency: 1,
    });
    const repeated = calculateIntentScore({
      productText: 'sales automation',
      icpText: 'sales leaders',
      audienceText: 'teams evaluating sales automation',
      signalType: 'request_for_solution',
      signalText: 'Need sales automation',
      frequency: 4,
    });
    const negative = calculateIntentScore({
      productText: 'sales automation',
      icpText: 'sales leaders',
      audienceText: 'teams evaluating sales automation',
      signalType: 'negative_fit',
      signalText: 'Not interested, already solved',
      negativeSignal: true,
    });
    expect(repeated.score).toBeGreaterThan(base.score);
    expect(negative.state).toBe('negative');
  });

  it('marks missing signal evidence explicitly', () => {
    const result = calculateIntentScore({
      productText: 'product',
      icpText: 'buyer',
      audienceText: 'audience',
      signalType: 'unknown',
      signalText: '',
    });
    expect(result.state).toBe('insufficient_evidence');
    expect(result.explanation.evidencePresent).toBe(false);
  });
});

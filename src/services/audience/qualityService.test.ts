import { describe, expect, it } from 'vitest';

import { scoreAudienceQuality, strategicScore } from './qualityService';

const complete = {
  strategicFit: 0.9,
  evidenceStrength: 0.9,
  identityConfidence: 1,
  contactVerification: 1,
  signalRecency: 1,
  sourceFreshness: 1,
  duplicateRisk: 0,
  suppressionClear: true,
  consentPermitted: true,
  reachable: true,
  enrichmentCompleteness: 1,
};

describe('audience quality', () => {
  it('keeps strategic evidence separate from operational readiness', () => {
    expect(strategicScore('high')).toBe(0.9);
    expect(scoreAudienceQuality(complete).state).toBe('ready');
  });

  it('blocks suppressed or restricted records regardless of score', () => {
    expect(scoreAudienceQuality({ ...complete, suppressionClear: false }).state).toBe(
      'suppressed',
    );
    expect(scoreAudienceQuality({ ...complete, consentPermitted: false }).state).toBe(
      'blocked',
    );
  });

  it('explains stale and incomplete records', () => {
    const result = scoreAudienceQuality({
      ...complete,
      stale: true,
      enrichmentCompleteness: 0.4,
      missingFields: ['industry', 'verified_email'],
    });
    expect(result.state).toBe('stale');
    expect(result.reasons).toContain('source or enrichment data is stale');
    expect(result.reasons.join(' ')).toContain('verified_email');
  });
});

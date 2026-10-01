import { describe, expect, it } from 'vitest';

import { buildOutreachDecision } from './decision';

describe('buildOutreachDecision', () => {
  it('determines email for a direct B2B motion', () => {
    expect(
      buildOutreachDecision({
        motion: 'b2b',
        buyerType: 'organization',
        routeType: 'direct',
        audienceProblem: 'Reduce manual reporting.',
      }),
    ).toMatchObject({ channel: 'email', outreach_motion: 'b2b' });
  });

  it('determines community outreach from the audience motion', () => {
    expect(
      buildOutreachDecision({
        motion: 'community',
        buyerType: 'individual',
        audienceProblem: 'Find a better rehearsal workflow.',
      }),
    ).toMatchObject({ channel: 'community', outreach_motion: 'community' });
  });
});

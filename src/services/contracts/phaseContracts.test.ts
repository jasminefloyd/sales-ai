import { describe, expect, it } from 'vitest';

import { ProductCreateInputSchema } from '../product/schemas';
import {
  AudienceChildSchema,
  EngagementProposalSchema,
  IcpSchema,
} from './phaseContracts';

describe('Sales OS phase contracts', () => {
  it('requires a URL or description and a primary conversion goal, while keeping geo optional', () => {
    expect(() =>
      ProductCreateInputSchema.parse({ name: 'Example', primaryObjective: 'signup' }),
    ).toThrow();
    expect(
      ProductCreateInputSchema.parse({
        name: 'Example',
        descriptionInput: 'A product for teams.',
        primaryObjective: 'signup',
      }).geographicConstraints,
    ).toBe('');
  });

  it('requires a stable ICP shape and explicit primary designation', () => {
    const result = IcpSchema.safeParse({
      name: 'Operators',
      buyerType: 'organization',
      summary: 'Teams with the problem.',
      coreProblem: 'Manual work.',
      whyProductFits: 'Automates it.',
      purchaseTrigger: 'New initiative.',
      currentAlternative: 'Spreadsheets.',
      buyingMotivation: 'Save time.',
      purchaseFriction: 'Budget.',
      evidence: [{ source: 'research' }],
      evidenceScore: 'medium',
      aiFitAssessment: 'Good fit.',
      priority: 'high',
      status: 'proposed',
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });

  it('requires audience-to-ICP version handoff and complete engagement review data', () => {
    expect(
      AudienceChildSchema.safeParse({
        icpId: '123e4567-e89b-12d3-a456-426614174000',
        icpVersion: 1,
        audienceVersion: 1,
        name: 'Reachable operators',
        summary: 'Operators discussing the problem publicly.',
        routeTypes: ['social'],
        reachabilityEvidence: [{ url: 'https://example.com' }],
        status: 'proposed',
      }).success,
    ).toBe(true);
    expect(
      EngagementProposalSchema.safeParse({
        opportunityId: '123e4567-e89b-12d3-a456-426614174001',
        channel: 'email',
        objective: 'Start a relevant conversation.',
        evidenceContext: [{ snippet: 'Need identified.' }],
        whyEngage: 'The opportunity matches the approved ICP.',
        messageAngle: 'Address the observed trigger.',
        cta: 'See the product.',
        message: 'Hello.',
        followUpStrategy: { cadence: 'manual' },
        riskSensitivity: 'Review before sending.',
        suppressionCheck: { result: 'passed' },
      }).success,
    ).toBe(true);
  });
});

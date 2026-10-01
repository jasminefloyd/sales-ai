import { describe, expect, it } from 'vitest';

import { buildAudienceProposal } from './audienceService';

describe('audience proposal contracts', () => {
  it('keeps audiences proposed and stores deterministic evidence separately from AI fit', () => {
    const result = buildAudienceProposal({
      productId: 'product-1',
      name: 'Working actors',
      buyerType: 'individual',
      problemUseCaseFit: 'Need accessible rehearsal support.',
      buyingBehavior: { research: true },
      purchaseTriggers: ['audition soon'],
      relevantTerminology: ['reader unavailable'],
      supportingEvidence: [
        {
          url: 'https://example.com/post',
          snippet: 'Need a reader tomorrow.',
          sourceType: 'forum',
        },
      ],
      evidenceInputs: {
        evidenceCount: 1,
        sourceDiversity: 1,
        signalSpecificity: 0.9,
        recencyDays: 2,
      },
      aiFitAssessment: 'Qualitative fit assessment.',
      priority: 'high',
      routes: [
        {
          routeType: 'social',
          rationale: 'Public problem conversations exist.',
          searchStrategy: { terms: ['reader unavailable'] },
        },
      ],
      actor: 'ai',
    });

    expect(result.audience.status).toBe('proposed');
    expect(result.audience.evidence_score_detail).toHaveProperty('rubricVersion');
    expect(result.audience.ai_fit_assessment).toBe('Qualitative fit assessment.');
    expect(result.routes[0].status).toBe('proposed');
  });
});

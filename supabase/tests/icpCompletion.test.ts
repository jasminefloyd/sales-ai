import { describe, expect, it } from 'vitest';

import { completeIcpCandidate } from '../functions/_shared/icpCompletion';

describe('ICP completion', () => {
  it('fills missing ICP fields from the product profile and marks inference for review', () => {
    const completed = completeIcpCandidate(
      { buyerType: 'organization' },
      {
        category: 'Rehearsal software',
        description: 'A rehearsal workspace for performing arts teams.',
        problems_solved: ['Coordinating rehearsal practice'],
        primary_use_cases: ['Classroom rehearsal'],
        core_capabilities: ['Shared rehearsal workspace'],
        purchase_triggers: ['A new season begins'],
        competitive_alternatives: ['Spreadsheets'],
        source_evidence: [],
      },
    );

    expect(completed.name).toBeTruthy();
    expect(completed.problemUseCaseFit).toBeTruthy();
    expect(completed.currentAlternative).toBeTruthy();
    expect(completed.purchaseFriction).toBeTruthy();
    expect(completed.budgetFit).toContain('AI inference');
    expect(completed.purchaseReadiness).toContain('AI inference');
    expect(completed.commercialEvidence).toHaveLength(1);
    expect(completed.completion.requiresHumanReview).toBe(true);
    expect(completed.routes.length).toBeGreaterThan(0);
  });

  it('preserves supplied values while completing only missing context', () => {
    const completed = completeIcpCandidate(
      {
        name: 'Performing arts schools',
        problemUseCaseFit: 'Teachers need structured rehearsal practice.',
        purchaseTriggers: ['A class assignment is due'],
        budgetFit: 'Department software budget',
      },
      { category: 'Education software', description: 'A rehearsal tool.' },
    );

    expect(completed.name).toBe('Performing arts schools');
    expect(completed.problemUseCaseFit).toBe(
      'Teachers need structured rehearsal practice.',
    );
    expect(completed.purchaseTriggers).toEqual(['A class assignment is due']);
    expect(completed.budgetFit).toBe('Department software budget');
    expect(completed.aiFitAssessment).toBeTruthy();
  });
});

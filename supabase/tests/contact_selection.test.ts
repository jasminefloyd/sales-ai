import { describe, expect, it } from 'vitest';
import { rankContactCandidates } from '../functions/_shared/contactSelection';

describe('direct-contact selection', () => {
  it('keeps at most three contacts and prioritizes decision-makers', () => {
    const selected = rankContactCandidates([
      { fullName: 'Staff Member', title: 'Technical Staff Member', evidence: ['role'] },
      { fullName: 'Founder', title: 'Founder and CEO', evidence: ['role', 'company'] },
      { fullName: 'Coordinator', title: 'Marketing Coordinator', evidence: ['role'] },
      { fullName: 'Director', title: 'Director of Operations', evidence: ['role'] },
      { fullName: 'Owner', title: 'Owner', evidence: ['role'] },
    ], 'owner or department leader', 3);

    expect(selected.map((contact) => contact.fullName)).toEqual([
      'Founder',
      'Owner',
      'Director',
    ]);
    expect(selected).toHaveLength(3);
  });

  it('deduplicates the same person before applying the cap', () => {
    const selected = rankContactCandidates([
      { fullName: 'Avery Smith', title: 'CEO', professionalEmail: 'avery@example.com' },
      { fullName: 'Avery Smith', title: 'CEO', professionalEmail: 'avery@example.com' },
      { fullName: 'Jordan Lee', title: 'VP Sales' },
    ]);
    expect(selected.map((contact) => contact.fullName)).toEqual(['Avery Smith', 'Jordan Lee']);
  });
});

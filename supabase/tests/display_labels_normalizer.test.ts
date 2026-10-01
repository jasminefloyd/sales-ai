import { describe, expect, it } from 'vitest';
import {
  decisionDisplayLabels,
  normalizeItemLabels,
  normalizeProfileLabels,
} from '../functions/_shared/displayLabels';

describe('display label normalizers', () => {
  it('matches canonical sources case-insensitively and drops invalid labels', () => {
    expect(
      normalizeItemLabels(
        [
          { label: 'Deal clarity', source: '  CRM fields  ' },
          { label: 'Too many words here for this item', source: 'CRM fields' },
        ],
        ['CRM fields'],
      ),
    ).toEqual([{ label: 'Deal clarity', source: 'CRM fields' }]);
  });
  it('never throws for malformed values and rejects banned words', () => {
    expect(normalizeItemLabels(null, ['a'])).toEqual([]);
    expect(
      normalizeItemLabels([{ label: 'Deterministic fallback', source: 'a' }], ['a']),
    ).toEqual([]);
  });
  it('normalizes profiles and decision goals', () => {
    expect(
      normalizeProfileLabels(
        {
          category: 'Sales intelligence',
          problemsSolved: [{ label: 'Deal clarity', source: 'CRM' }],
        },
        {
          problemsSolved: ['CRM'],
          primaryUseCases: [],
          competitiveAlternatives: [],
          purchaseFriction: '',
        },
      ).problemsSolved,
    ).toEqual([{ label: 'Deal clarity', source: 'CRM' }]);
    expect(
      decisionDisplayLabels({
        channel: 'email',
        motion: 'b2b',
        conversionEvent: { primaryEvent: 'Book a demo' },
        isFallback: true,
      }).goal,
    ).toBe('Book conversations through email');
  });
});

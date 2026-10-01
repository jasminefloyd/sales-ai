import { describe, expect, it } from 'vitest';
import {
  chipsFor,
  isNearDuplicate,
  isPlaceholder,
  shorten,
  textFor,
} from './presenters';

describe('product workflow copy budgets', () => {
  it('shortens at sentence, clause, and word boundaries', () => {
    expect(shorten('A short sentence. Another sentence follows.', 3)).toBe(
      'A short sentence',
    );
    expect(shorten('Teams lose context, which slows decisions.', 4)).toBe(
      'Teams lose context',
    );
    expect(shorten('one two three four five six', 4)).toBe('one two three four…');
    expect(shorten('one two', 4)).toBe('one two');
  });
  it('recognizes placeholders and near duplicates', () => {
    expect(isPlaceholder('Unknown; human review required.')).toBe(true);
    expect(isPlaceholder('N/A')).toBe(true);
    expect(isPlaceholder('Useful buyer context')).toBe(false);
    expect(
      isNearDuplicate(
        'Deal context gets lost between CRM fields',
        'Deal context is lost between CRM fields',
      ),
    ).toBe(true);
  });
  it('keeps chips bounded and uses matching display labels', () => {
    const result = chipsFor(
      [
        'A very long canonical problem statement',
        'Second item',
        'Third item',
        'Fourth item',
        'Fifth item',
      ],
      4,
      [{ label: 'Long problem', source: 'A very long canonical problem statement' }],
    );
    expect(result.items).toEqual([
      'Long problem',
      'Second item',
      'Third item',
      'Fourth item',
    ]);
    expect(result.more).toBe(1);
    expect(textFor('Short label', 'Long canonical sentence', 3)).toBe('Short label');
  });
});

import { describe, expect, it } from 'vitest';

import { detectProductSourceFormat, parseProductSource } from './sourceParser';

describe('product source parser', () => {
  it('selects adapters by file metadata', () => {
    expect(detectProductSourceFormat('brief.md', 'text/markdown')).toBe('markdown');
    expect(detectProductSourceFormat('brief.json', 'application/json')).toBe(
      'structured',
    );
    expect(detectProductSourceFormat('brief.pdf', 'application/pdf')).toBe('document');
  });

  it('preserves non-markdown source content for review', () => {
    expect(parseProductSource('brief.txt', 'A product brief').descriptionInput).toBe(
      'A product brief',
    );
  });

  it('extracts labeled fields from document text and supplies a reviewable objective', () => {
    const parsed = parseProductSource(
      'release-package.pdf',
      'AI Sales OS\nObjective: Generate qualified product signups.\nAudience: Founders.',
      'application/pdf',
    );
    expect(parsed.name).toBe('AI Sales OS');
    expect(parsed.primaryObjective).toBe('Generate qualified product signups.');
    expect(parsed.knownAudiences).toBe('Founders.');
  });

  it('provides an explicit review fallback when a document omits its objective', () => {
    expect(
      parseProductSource('brief.pdf', 'A product for teams.', 'application/pdf')
        .primaryObjective,
    ).toContain('Determine the primary conversion goal');
  });
});

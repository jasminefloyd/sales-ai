import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(
  resolve(process.cwd(), 'src/app/AudienceIntelligencePage.tsx'),
  'utf8',
);

describe('Audience Intelligence analytics UI contract', () => {
  it('exposes the required analytics areas and filters', () => {
    expect(page).toContain("'overview'");
    expect(page).toContain("'audiences'");
    expect(page).toContain("'signals'");
    expect(page).toContain("'enrichment'");
    expect(page).toContain("'activation'");
    expect(page).toContain("'providers'");
    expect(page).toContain('All ICPs');
    expect(page).toContain('All providers');
    expect(page).toContain('All channels');
  });
});

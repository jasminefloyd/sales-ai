import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(
  resolve(process.cwd(), 'src/app/ProductWorkflowPage.tsx'),
  'utf8',
);
const explanations = readFileSync(
  resolve(process.cwd(), 'src/services/evidence/explanations.ts'),
  'utf8',
);
const disclosure = readFileSync(
  resolve(process.cwd(), 'src/app/productWorkflow/Disclosure.tsx'),
  'utf8',
);
const copy = readFileSync(
  resolve(process.cwd(), 'src/app/productWorkflow/copy.ts'),
  'utf8',
);

describe('Sales OS Phase 7 evidence explanation wiring', () => {
  it('loads persisted evidence and exposes expandable audience explanations', () => {
    expect(page).toContain("from('sales_os_evidence_records')");
    expect(page).toContain('Why this audience?');
    expect(page).toContain('source_url');
    expect(disclosure).toContain('Why this recommendation?');
    expect(copy).toContain('Why this audience?');
    expect(copy).toContain('whyChannel');
  });

  it('has deterministic support and insufficient-evidence states', () => {
    expect(explanations).toContain('insufficient_evidence');
    expect(explanations).toContain(
      'Insufficient evidence: no linked source or excerpt is available.',
    );
    expect(explanations).toContain('persisted evidence item');
  });
});

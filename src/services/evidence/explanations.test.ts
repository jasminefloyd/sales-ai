import { describe, expect, it } from 'vitest';
import { summarizeEvidence } from './explanations';

describe('evidence explanations', () => {
  it('reports an explicit evidence gap instead of inventing support', () => {
    expect(summarizeEvidence([])).toEqual({
      state: 'insufficient_evidence',
      confidence: 'low',
      explanation: 'Insufficient evidence: no linked source or excerpt is available.',
    });
  });

  it('summarizes persisted evidence deterministically', () => {
    const result = summarizeEvidence([
      { sourceType: 'research', snippet: 'A source excerpt.', confidence: 'high' },
    ]);
    expect(result.state).toBe('supported');
    expect(result.confidence).toBe('high');
    expect(result.explanation).toContain('1 persisted evidence item');
  });
});

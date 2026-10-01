import { describe, expect, it } from 'vitest';

import { EVIDENCE_RUBRIC_V1, scoreEvidence } from './scoring';

describe('deterministic evidence scoring', () => {
  it('stores raw rubric inputs and the rubric version', () => {
    const result = scoreEvidence({
      evidenceCount: 2,
      sourceDiversity: 2,
      signalSpecificity: 0.5,
      recencyDays: 10,
    });
    expect(result.detail.rubricVersion).toBe(EVIDENCE_RUBRIC_V1.version);
    expect(result.detail.evidenceCount).toBe(2);
    expect(result.detail.normalized.signalSpecificity).toBe(0.5);
  });

  it('maps deterministic inputs to low, medium, and high', () => {
    expect(
      scoreEvidence({
        evidenceCount: 0,
        sourceDiversity: 0,
        signalSpecificity: 0,
        recencyDays: null,
      }).score,
    ).toBe('low');
    expect(
      scoreEvidence({
        evidenceCount: 2,
        sourceDiversity: 2,
        signalSpecificity: 0.5,
        recencyDays: 30,
      }).score,
    ).toBe('medium');
    expect(
      scoreEvidence({
        evidenceCount: 4,
        sourceDiversity: 3,
        signalSpecificity: 1,
        recencyDays: 0,
      }).score,
    ).toBe('high');
  });
});

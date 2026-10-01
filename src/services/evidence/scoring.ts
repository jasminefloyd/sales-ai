export const EVIDENCE_RUBRIC_V1 = {
  version: 'evidence_v1',
  weights: {
    evidenceCount: 0.25,
    sourceDiversity: 0.25,
    signalSpecificity: 0.25,
    recency: 0.25,
  },
  evidenceCountSaturation: 4,
  sourceDiversitySaturation: 3,
  recencyMaxDays: 90,
  thresholds: {
    medium: 0.45,
    high: 0.75,
  },
} as const;

export type EvidenceInputs = {
  evidenceCount: number;
  sourceDiversity: number;
  signalSpecificity: number;
  recencyDays: number | null;
};

export type EvidenceScore = 'low' | 'medium' | 'high';

export type EvidenceScoreDetail = EvidenceInputs & {
  rubricVersion: string;
  normalized: {
    evidenceCount: number;
    sourceDiversity: number;
    signalSpecificity: number;
    recency: number;
  };
  weightedTotal: number;
  score: EvidenceScore;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function scoreEvidence(inputs: EvidenceInputs): {
  score: EvidenceScore;
  detail: EvidenceScoreDetail;
} {
  const normalized = {
    evidenceCount: clamp(
      inputs.evidenceCount / EVIDENCE_RUBRIC_V1.evidenceCountSaturation,
    ),
    sourceDiversity: clamp(
      inputs.sourceDiversity / EVIDENCE_RUBRIC_V1.sourceDiversitySaturation,
    ),
    signalSpecificity: clamp(inputs.signalSpecificity),
    recency:
      inputs.recencyDays === null
        ? 0
        : clamp(1 - inputs.recencyDays / EVIDENCE_RUBRIC_V1.recencyMaxDays),
  };
  const weightedTotal =
    normalized.evidenceCount * EVIDENCE_RUBRIC_V1.weights.evidenceCount +
    normalized.sourceDiversity * EVIDENCE_RUBRIC_V1.weights.sourceDiversity +
    normalized.signalSpecificity * EVIDENCE_RUBRIC_V1.weights.signalSpecificity +
    normalized.recency * EVIDENCE_RUBRIC_V1.weights.recency;
  const score: EvidenceScore =
    weightedTotal >= EVIDENCE_RUBRIC_V1.thresholds.high
      ? 'high'
      : weightedTotal >= EVIDENCE_RUBRIC_V1.thresholds.medium
        ? 'medium'
        : 'low';

  return {
    score,
    detail: {
      ...inputs,
      rubricVersion: EVIDENCE_RUBRIC_V1.version,
      normalized,
      weightedTotal,
      score,
    },
  };
}

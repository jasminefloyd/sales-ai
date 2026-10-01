export type EvidenceItem = {
  url?: string | null;
  sourceUrl?: string | null;
  sourceReference?: string | null;
  snippet?: string | null;
  excerpt?: string | null;
  sourceType?: string | null;
  evidenceStatus?: string | null;
  confidence?: string | null;
};

export type EvidenceSummary = {
  state: 'supported' | 'insufficient_evidence';
  confidence: 'low' | 'medium' | 'high';
  explanation: string;
};

export function summarizeEvidence(
  items: EvidenceItem[] | null | undefined,
): EvidenceSummary {
  const usable = (items ?? []).filter((item) =>
    Boolean(
      item.url ||
      item.sourceUrl ||
      item.sourceReference ||
      item.snippet ||
      item.excerpt,
    ),
  );
  if (!usable.length) {
    return {
      state: 'insufficient_evidence',
      confidence: 'low',
      explanation: 'Insufficient evidence: no linked source or excerpt is available.',
    };
  }
  const confidence = usable.some((item) => item.confidence === 'high')
    ? 'high'
    : usable.some((item) => item.confidence === 'medium')
      ? 'medium'
      : 'low';
  return {
    state: 'supported',
    confidence,
    explanation: `${usable.length} persisted evidence item${usable.length === 1 ? '' : 's'} support this recommendation. Review the linked source before treating qualitative claims as verified.`,
  };
}

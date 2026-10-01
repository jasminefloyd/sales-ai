export const QUALITY_CALCULATION_VERSION = 'quality_v1';

export type QualityState =
  'ready' | 'needs_enrichment' | 'stale' | 'low_confidence' | 'suppressed' | 'blocked';

export type QualityInput = {
  strategicFit: number;
  evidenceStrength: number;
  identityConfidence: number;
  contactVerification: number;
  signalRecency: number;
  sourceFreshness: number;
  duplicateRisk: number;
  suppressionClear: boolean;
  consentPermitted: boolean;
  reachable: boolean;
  enrichmentCompleteness: number;
  missingFields?: string[];
  stale?: boolean;
};

export type QualityResult = {
  score: number;
  state: QualityState;
  reasons: string[];
  dimensions: Record<string, number>;
};

function bounded(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function scoreAudienceQuality(input: QualityInput): QualityResult {
  const dimensions = {
    strategicFit: bounded(input.strategicFit),
    evidenceStrength: bounded(input.evidenceStrength),
    identityConfidence: bounded(input.identityConfidence),
    contactVerification: bounded(input.contactVerification),
    signalRecency: bounded(input.signalRecency),
    sourceFreshness: bounded(input.sourceFreshness),
    duplicateRisk: bounded(input.duplicateRisk),
    suppressionClear: input.suppressionClear ? 1 : 0,
    consentPermitted: input.consentPermitted ? 1 : 0,
    reachable: input.reachable ? 1 : 0,
    enrichmentCompleteness: bounded(input.enrichmentCompleteness),
  };
  const score = Number(
    (
      dimensions.strategicFit * 0.12 +
      dimensions.evidenceStrength * 0.12 +
      dimensions.identityConfidence * 0.12 +
      dimensions.contactVerification * 0.14 +
      dimensions.signalRecency * 0.06 +
      dimensions.sourceFreshness * 0.08 +
      (1 - dimensions.duplicateRisk) * 0.08 +
      dimensions.suppressionClear * 0.1 +
      dimensions.consentPermitted * 0.08 +
      dimensions.reachable * 0.04 +
      dimensions.enrichmentCompleteness * 0.06
    ).toFixed(4),
  );
  const reasons: string[] = [];
  if (!input.suppressionClear) reasons.push('suppressed');
  if (!input.consentPermitted) reasons.push('consent is restricted or revoked');
  if (input.stale) reasons.push('source or enrichment data is stale');
  if (input.missingFields?.length)
    reasons.push(`missing: ${input.missingFields.join(', ')}`);
  if (input.duplicateRisk >= 0.65) reasons.push('duplicate risk requires review');
  if (!input.reachable) reasons.push('no verified reachable contact');
  if (input.identityConfidence < 0.65) reasons.push('identity confidence is low');
  const state: QualityState = !input.consentPermitted
    ? 'blocked'
    : !input.suppressionClear
      ? 'suppressed'
      : input.stale
        ? 'stale'
        : input.missingFields?.length || input.enrichmentCompleteness < 0.8
          ? 'needs_enrichment'
          : input.identityConfidence < 0.65 || score < 0.6
            ? 'low_confidence'
            : 'ready';
  return { score, state, reasons, dimensions };
}

export function freshnessScore(
  freshnessAt: string | null | undefined,
  now = Date.now(),
) {
  if (!freshnessAt) return 0;
  const timestamp = Date.parse(freshnessAt);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  return Math.max(0, Math.min(1, 1 - ageDays / 30));
}

export function strategicScore(evidenceScore: string | null | undefined) {
  return evidenceScore === 'high' ? 0.9 : evidenceScore === 'medium' ? 0.65 : 0.35;
}

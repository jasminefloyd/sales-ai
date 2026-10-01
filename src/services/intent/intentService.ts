export const INTENT_CALCULATION_VERSION = 'intent_v1';

export type SignalDirection = 'positive' | 'negative' | 'neutral';

export type IntentInput = {
  productText: string;
  icpText: string;
  audienceText: string;
  signalType: string;
  signalText: string;
  direction?: SignalDirection;
  baseWeight?: number;
  observedAt?: string | null;
  frequency?: number;
  priorEngagements?: number;
  negativeSignal?: boolean;
  now?: number;
};

export type IntentResult = {
  score: number;
  state: 'high' | 'medium' | 'low' | 'negative' | 'insufficient_evidence';
  explanation: Record<string, unknown>;
};

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 2),
  );
}

function overlap(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / a.size;
}

export function normalizeSignalType(value: string | null | undefined): string {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  if (/request|looking|recommend|how_do/.test(normalized))
    return 'request_for_solution';
  if (/pain|complaint|frustrat|broken|struggle/.test(normalized))
    return 'pain_complaint';
  if (/price|pricing|cost|budget/.test(normalized)) return 'pricing_signal';
  if (/competitor|alternative|switch/.test(normalized)) return 'competitor_reference';
  if (/negative|not_interested|no_need/.test(normalized)) return 'negative_fit';
  if (/direct_contact/.test(normalized)) return 'direct_contact_fit';
  return normalized || 'relevant_discussion';
}

export function calculateIntentScore(input: IntentInput): IntentResult {
  const direction = input.negativeSignal ? 'negative' : (input.direction ?? 'positive');
  const recencyDays = input.observedAt
    ? Math.max(
        0,
        ((input.now ?? Date.now()) - Date.parse(input.observedAt)) / 86_400_000,
      )
    : null;
  const recencyDecay = recencyDays === null ? 0.5 : Math.max(0, 1 - recencyDays / 90);
  const productFit = overlap(input.signalText, input.productText);
  const icpFit = overlap(input.signalText, input.icpText);
  const audienceFit = overlap(input.signalText, input.audienceText);
  const frequencyBoost = Math.min(0.25, Math.max(0, (input.frequency ?? 1) - 1) * 0.05);
  const priorEngagementBoost = Math.min(
    0.15,
    Math.max(0, input.priorEngagements ?? 0) * 0.03,
  );
  const base = input.baseWeight ?? 0.5;
  const unbounded =
    base * 0.3 +
    productFit * 0.2 +
    icpFit * 0.2 +
    audienceFit * 0.1 +
    recencyDecay * 0.15 +
    frequencyBoost +
    priorEngagementBoost;
  const penalty = direction === 'negative' ? 0.45 : 0;
  const score = Math.max(0, Math.min(1, Number((unbounded - penalty).toFixed(4))));
  const explanation = {
    calculationVersion: INTENT_CALCULATION_VERSION,
    normalizedSignalType: normalizeSignalType(input.signalType),
    direction,
    baseWeight: base,
    productFit,
    icpFit,
    audienceFit,
    recencyDays,
    recencyDecay,
    frequency: input.frequency ?? 1,
    frequencyBoost,
    priorEngagements: input.priorEngagements ?? 0,
    priorEngagementBoost,
    negativePenalty: penalty,
    evidencePresent: Boolean(input.signalText.trim()),
  };
  const state = !input.signalText.trim()
    ? 'insufficient_evidence'
    : direction === 'negative'
      ? 'negative'
      : score >= 0.75
        ? 'high'
        : score >= 0.45
          ? 'medium'
          : 'low';
  return { score, state, explanation };
}

export function normalizeProviderSignal(input: Record<string, unknown>) {
  const signalText = String(
    input.signalText ??
      input.text ??
      input.excerpt ??
      input.description ??
      input.title ??
      '',
  ).trim();
  return {
    signalType: normalizeSignalType(
      String(input.signalType ?? input.signal_type ?? 'relevant_discussion'),
    ),
    signalText,
    sourceUrl: typeof input.url === 'string' ? input.url : null,
    observedAt: typeof input.observedAt === 'string' ? input.observedAt : null,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
  };
}

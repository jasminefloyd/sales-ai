export type ItemLabel = { label: string; source: string };
export type ProfileDisplayLabels = {
  schemaVersion: 1;
  category?: string;
  description?: string;
  problemsSolved?: ItemLabel[];
  primaryUseCases?: ItemLabel[];
  competitiveAlternatives?: ItemLabel[];
  purchaseFriction?: ItemLabel[];
  conversionEvent?: Partial<
    Record<'trigger' | 'primaryEvent' | 'outcome' | 'secondaryEvent', string>
  >;
};
export type IcpDisplayLabels = {
  schemaVersion: 1;
  name?: string;
  summary?: string;
  whyItFits?: string;
};
export type AudienceDisplayLabels = {
  schemaVersion: 1;
  name?: string;
  problem?: string;
  purchaseTriggers?: ItemLabel[];
};
export type DecisionDisplayLabels = { schemaVersion: 1; goal?: string; why?: string };

export const LABEL_LIMITS = {
  itemLabelWords: 5,
  categoryWords: 5,
  descriptionWords: 25,
  nameWords: 6,
  problemWords: 15,
  summaryWords: 20,
  goalWords: 12,
  whyWords: 30,
  conversionWords: 6,
} as const;

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const norm = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const BANNED = /fallback|deterministic|persisted|provider|human review|\bunknown\b/i;
function okText(value: unknown, maxWords: number) {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim().replace(/[.]$/, '');
  return text && wordCount(text) <= maxWords && !BANNED.test(text) ? text : undefined;
}
export function normalizeItemLabels(
  raw: unknown,
  canonical: string[],
  maxWords = LABEL_LIMITS.itemLabelWords,
): ItemLabel[] {
  if (!Array.isArray(raw)) return [];
  const byNorm = new Map(canonical.map((item) => [norm(String(item)), String(item)]));
  const seen = new Set<string>();
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const label = okText(item.label, maxWords);
    const source =
      typeof item.source === 'string' ? byNorm.get(norm(item.source)) : undefined;
    if (!label || !source || seen.has(source)) return [];
    seen.add(source);
    return [{ label, source }];
  });
}
export function normalizeProfileLabels(
  raw: unknown,
  profile: {
    problemsSolved: unknown[];
    primaryUseCases: unknown[];
    competitiveAlternatives: unknown[];
    purchaseFriction: string;
  },
): ProfileDisplayLabels {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const conversion =
    value.conversionEvent && typeof value.conversionEvent === 'object'
      ? (value.conversionEvent as Record<string, unknown>)
      : {};
  const conversionEvent = Object.fromEntries(
    (['trigger', 'primaryEvent', 'outcome', 'secondaryEvent'] as const)
      .map((key) => [key, okText(conversion[key], LABEL_LIMITS.conversionWords)])
      .filter(([, item]) => item),
  );
  return {
    schemaVersion: 1,
    category: okText(value.category, LABEL_LIMITS.categoryWords),
    description: okText(value.description, LABEL_LIMITS.descriptionWords),
    problemsSolved: normalizeItemLabels(
      value.problemsSolved,
      profile.problemsSolved.map(String),
    ),
    primaryUseCases: normalizeItemLabels(
      value.primaryUseCases,
      profile.primaryUseCases.map(String),
    ),
    competitiveAlternatives: normalizeItemLabels(
      value.competitiveAlternatives,
      profile.competitiveAlternatives.map(String),
    ),
    purchaseFriction: normalizeItemLabels(
      value.purchaseFriction,
      profile.purchaseFriction.split(/;\s*/),
    ),
    conversionEvent,
  };
}
export function normalizeIcpLabels(raw: unknown): IcpDisplayLabels {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    schemaVersion: 1,
    name: okText(value.name, LABEL_LIMITS.nameWords),
    summary: okText(value.summary, LABEL_LIMITS.summaryWords),
    whyItFits: okText(value.whyItFits, LABEL_LIMITS.whyWords),
  };
}
export function normalizeAudienceLabels(
  raw: unknown,
  canonical: { purchaseTriggers: unknown[] },
): AudienceDisplayLabels {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    schemaVersion: 1,
    name: okText(value.name, LABEL_LIMITS.nameWords),
    problem: okText(value.problem, LABEL_LIMITS.problemWords),
    purchaseTriggers: normalizeItemLabels(
      value.purchaseTriggers,
      canonical.purchaseTriggers.map(String),
    ),
  };
}
export function normalizeDecisionLabels(raw: unknown): DecisionDisplayLabels {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    schemaVersion: 1,
    goal: okText(value.goal, LABEL_LIMITS.goalWords),
    why: okText(value.why, LABEL_LIMITS.whyWords),
  };
}

const CHANNEL_NAMES: Record<string, string> = {
  email: 'email',
  reddit: 'Reddit',
  community: 'community posts',
  professional_social: 'LinkedIn',
};
const CONVERSION_VERBS: Array<[RegExp, string]> = [
  [/sign ?up|register|trial|account/i, 'Get sign-ups'],
  [/demo|call|meeting|walkthrough|conversation/i, 'Book conversations'],
  [/purchase|buy|paid|subscri|checkout|payment/i, 'Drive purchases'],
];
export function decisionDisplayLabels(input: {
  channel: string;
  motion: string;
  conversionEvent: Record<string, unknown>;
  isFallback: boolean;
}): DecisionDisplayLabels {
  const primary = String(
    input.conversionEvent.primaryEvent ?? input.conversionEvent.outcome ?? '',
  );
  const verb =
    CONVERSION_VERBS.find(([pattern]) => pattern.test(primary))?.[1] ??
    'Start conversations';
  const via = CHANNEL_NAMES[input.channel] ?? input.channel;
  return {
    schemaVersion: 1,
    goal: `${verb} through ${via}`,
    why: input.isFallback
      ? `Suggested from your sales profile, which targets ${input.motion === 'b2b' ? 'businesses' : 'individuals'}.`
      : undefined,
  };
}

import { BUDGET } from './budgets';
import {
  channelLabel,
  chipsFor,
  collateralLabel,
  isNearDuplicate,
  isPlaceholder,
  shorten,
  textFor,
} from './presenters';
import type { DisplayLabels, ItemLabel } from './types';

export type BadgeView = {
  tone: 'approved' | 'review' | 'warn' | 'neutral';
  label: string;
};
export type StatView = {
  label: string;
  value: string;
  tone?: 'ok' | 'pending' | 'warn';
  meter?: 'low' | 'medium' | 'high';
};
export type SourceView = { title: string; detail?: string; url?: string };
export type CardView = {
  glance: {
    title: string;
    subtitle?: string;
    badges: BadgeView[];
    chips?: { items: string[]; more: number };
    stats?: StatView[];
    line?: { label: string; text: string };
  };
  explain: {
    label: string;
    paragraphs: string[];
    facts?: Array<[string, string]>;
    sources: SourceView[];
    fullText?: Array<[string, string]>;
  } | null;
  audit: Array<[string, string]>;
};

type Row = Record<string, unknown> & { display_labels?: DisplayLabels };
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
function labels(value: DisplayLabels | undefined, key: keyof DisplayLabels) {
  const result = value?.[key];
  return Array.isArray(result) ? (result as ItemLabel[]) : undefined;
}
function badge(status: unknown): BadgeView {
  return status === 'approved' || status === 'active'
    ? { tone: 'approved', label: 'Approved' }
    : { tone: 'review', label: 'Needs review' };
}
function sources(value: unknown): SourceView[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const title = String(row.sourceType ?? row.type ?? row.source ?? 'Source');
    const detail = String(row.snippet ?? row.relevance ?? '').trim();
    const url = typeof row.url === 'string' ? row.url : undefined;
    const key = url || detail || title;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ title, detail: detail || undefined, url }];
  });
}

export function presentProfile(profile: Row): CardView {
  const problems = chipsFor(
    strings(profile.problems_solved),
    3,
    labels(profile.display_labels, 'problemsSolved'),
  );
  const uses = chipsFor(
    strings(profile.primary_use_cases),
    3,
    labels(profile.display_labels, 'primaryUseCases'),
  );
  const description = String(
    profile.description ?? 'Product information is ready for review.',
  );
  return {
    glance: {
      title: textFor(
        profile.display_labels?.category,
        String(profile.category ?? 'Sales profile'),
        BUDGET.titleWords,
      ),
      subtitle: textFor(profile.display_labels?.description, description, 25),
      badges: [badge(profile.review_status)],
      chips: {
        items: [...problems.items, ...uses.items].slice(0, BUDGET.visibleChips),
        more: problems.more + uses.more,
      },
      line: profile.outreach_motion
        ? { label: 'Motion', text: String(profile.outreach_motion) }
        : undefined,
    },
    explain: {
      label: 'More profile details',
      paragraphs: [],
      sources: sources(profile.source_evidence),
      fullText: [['Description', description]],
    },
    audit: [
      ['Version', String(profile.version ?? '—')],
      [
        'Source records',
        String(
          Array.isArray(profile.source_evidence) ? profile.source_evidence.length : 0,
        ),
      ],
    ],
  };
}

export function presentIcp(icp: Row): CardView {
  const summary = String(icp.summary ?? '');
  const problem = String(icp.core_problem ?? '');
  const duplicate = isNearDuplicate(summary, problem);
  return {
    glance: {
      title: textFor(
        icp.display_labels?.name,
        String(icp.name ?? 'ICP'),
        BUDGET.titleWords,
      ),
      subtitle: textFor(
        icp.display_labels?.summary,
        summary || problem || 'ICP definition pending.',
        15,
      ),
      badges: [
        { tone: 'neutral', label: icp.is_primary ? 'Primary' : 'Additional' },
        badge(icp.validation_status),
      ],
      stats: icp.evidence_score
        ? [{ label: 'Evidence', value: String(icp.evidence_score) }]
        : undefined,
    },
    explain: {
      label: 'Why this ICP?',
      paragraphs: [icp.display_labels?.whyItFits ?? String(icp.why_product_fits ?? '')]
        .filter((text) => Boolean(text && !isPlaceholder(text)))
        .map((text) => shorten(text, 30)),
      facts: (
        [
          ['Core problem', problem],
          ['Purchase trigger', String(icp.purchase_trigger ?? '')],
          ['AI assessment', String(icp.ai_fit_assessment ?? '')],
        ] as Array<[string, string]>
      ).filter(([, value]) =>
        Boolean(value && !isPlaceholder(value) && !(duplicate && value === problem)),
      ),
      sources: [],
    },
    audit: [
      ['Version', String(icp.version ?? '—')],
      ['Validation status', String(icp.validation_status ?? 'Not known yet')],
    ],
  };
}

export function presentAudience(
  audience: Row,
  context?: { parentIcpSummary?: string; profileMotion?: string | null },
): CardView {
  const problem = String(audience.problem_use_case_fit ?? '');
  const rawName = String(audience.name ?? '').trim();
  // Older audience records stored a display-truncated name. The complete
  // problem/use-case sentence is the authoritative readable fallback for
  // those records; never render the stored ellipsis as if it were content.
  const titleSource = /(?:\.\.\.|…)$/.test(rawName) && problem ? problem : rawName;
  const hiddenProblem = Boolean(
    context?.parentIcpSummary && isNearDuplicate(problem, context.parentIcpSummary),
  );
  const triggers = chipsFor(
    strings(audience.purchase_triggers),
    strings(audience.purchase_triggers).length || 1,
  );
  const badges = [badge(audience.status)];
  if (audience.outreach_motion && audience.outreach_motion !== context?.profileMotion)
    badges.push({ tone: 'neutral', label: 'Motion differs' });
  return {
    glance: {
      title:
        titleSource || problem || 'Audience',
      subtitle: hiddenProblem
        ? undefined
        : problem || 'Audience definition pending.',
      badges,
      chips: { items: triggers.items, more: triggers.more },
      stats: audience.evidence_score
        ? [{ label: 'Evidence', value: String(audience.evidence_score) }]
        : undefined,
    },
    explain: {
      label: 'Why this audience?',
      paragraphs: [String(audience.outreach_motion_reason ?? '')]
        .filter((text) => Boolean(text && !isPlaceholder(text)))
        .map((text) => shorten(text, 30)),
      facts: (
        [
          [
            'Terminology',
            strings(audience.relevant_terminology).slice(0, 3).join(', '),
          ],
          ['Quality', String(audience.quality_state ?? '')],
        ] as Array<[string, string]>
      ).filter(([, value]) => Boolean(value && !isPlaceholder(value))),
      sources: [],
      fullText: hiddenProblem ? [['Problem', problem]] : undefined,
    },
    audit: [
      ['Audience version', String(audience.audience_version ?? '—')],
      ['ICP version', String(audience.icp_version ?? '—')],
    ],
  };
}

export function presentDecision(
  decision: Row,
  context?: { audienceProblem?: string },
): CardView {
  const objective = String(decision.objective ?? '');
  const duplicate = Boolean(
    context?.audienceProblem && isNearDuplicate(objective, context.audienceProblem),
  );
  return {
    glance: {
      title: channelLabel(decision.channel),
      subtitle: collateralLabel(decision.collateral_type),
      badges: [badge(decision.status)],
      line:
        duplicate || !objective
          ? undefined
          : {
              label: 'Goal',
              text: shorten(
                String(decision.display_labels?.goal ?? objective),
                BUDGET.goalWords,
              ),
            },
    },
    explain: {
      label: `Why ${channelLabel(decision.channel).toLowerCase()}?`,
      paragraphs: [decision.display_labels?.why ?? String(decision.rationale ?? '')]
        .filter((text) => Boolean(text && !isPlaceholder(text)))
        .map((text) => shorten(text, BUDGET.whyWords)),
      sources: [],
    },
    audit: [
      ['Objective', objective || 'Not known yet'],
      ['Decision version', String(decision.version ?? '—')],
      ['Audience version', String(decision.audience_version ?? '—')],
      ['ICP version', String(decision.icp_version ?? '—')],
    ],
  };
}

export function presentCopy(copy: Row): CardView {
  return {
    glance: {
      title: shorten(
        String(copy.message_angle || copy.copy_type || 'Generated outreach copy'),
        BUDGET.titleWords,
      ),
      subtitle: channelLabel(copy.channel),
      badges: [badge(copy.status)],
      line:
        copy.cta && !isPlaceholder(String(copy.cta))
          ? {
              label: 'Call to action',
              text: shorten(String(copy.cta), BUDGET.chipWords),
            }
          : undefined,
    },
    explain: {
      label: 'Why this angle?',
      paragraphs: [],
      facts: (
        [
          ['Subject', String(copy.subject ?? '')],
          ['Message angle', String(copy.message_angle ?? '')],
        ] as Array<[string, string]>
      ).filter(([, value]) => Boolean(value && !isPlaceholder(value))),
      sources: [],
    },
    audit: [['Copy type', String(copy.copy_type ?? 'Not known yet')]],
  };
}

export function presentSource(source: Row): CardView {
  const title = String(source.file_name || source.source_type || 'Product source');
  return {
    glance: {
      title: shorten(title, BUDGET.titleWords),
      badges: [
        {
          tone: source.parse_status === 'parsed' ? 'approved' : 'review',
          label: source.parse_status === 'parsed' ? 'Parsed' : 'Processing',
        },
      ],
    },
    explain: source.content ? { label: 'Preview', paragraphs: [], sources: [] } : null,
    audit: [
      ['Source type', String(source.source_type ?? 'Not known yet')],
      ['Parse status', String(source.parse_status ?? 'Not known yet')],
      ['Characters', String(String(source.content ?? '').length)],
    ],
  };
}

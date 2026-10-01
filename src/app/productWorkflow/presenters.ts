export type WorkflowStage =
  | 'product_input'
  | 'profile_review'
  | 'strategy_generation'
  | 'outreach_review'
  | 'copy_generation';
import { BUDGET } from './budgets';
import { COPY } from './copy';
import type { DisplayLabels, ItemLabel } from './types';

export const WORKFLOW_STAGES = new Set<WorkflowStage>([
  'product_input',
  'profile_review',
  'strategy_generation',
  'outreach_review',
  'copy_generation',
]);

export type WorkflowJobLike = {
  id?: string;
  job_type?: string;
  workflow_stage?: string | null;
  status: string;
  error?: Record<string, unknown> | null;
  created_at?: string;
};

export type StepStatus = 'locked' | 'working' | 'review' | 'attention' | 'approved';

export type WorkflowStepView = {
  id: 'source' | 'profile' | 'audiences' | 'outreach' | 'copy';
  label: string;
  status: StepStatus;
  summary: string;
  reviewCount: number;
};

export type VersionedDecisionLike = {
  id: string;
  audience_id: string;
  audience_version: number;
  status: string;
};

export function splitDecisionsByVersion<T extends VersionedDecisionLike>(
  decisions: T[],
  audiences: Array<{ id: string; audience_version: number }>,
) {
  const currentVersions = new Map(
    audiences.map((audience) => [audience.id, audience.audience_version]),
  );
  const current: T[] = [];
  const earlier: T[] = [];
  for (const decision of decisions) {
    if (decision.status === 'rejected') {
      earlier.push(decision);
      continue;
    }
    if (currentVersions.get(decision.audience_id) === decision.audience_version)
      current.push(decision);
    else earlier.push(decision);
  }
  return { current, earlier };
}

export type WorkflowSnapshot = {
  hasInput: boolean;
  hasProfile: boolean;
  profileStatus: string | null;
  hasProposedAudience: boolean;
  hasApprovedAudience: boolean;
  hasProposedDecision: boolean;
  hasApprovedDecision: boolean;
  copyCount: number;
  awaitingCopyCount: number;
  approvedCopyCount: number;
  sourceCount?: number;
  profileVersion?: number | null;
  audienceReviewCount?: number;
  approvedAudienceCount?: number;
  decisionReviewCount?: number;
  approvedDecisionCount?: number;
  jobs: WorkflowJobLike[];
};

function scopedJobs(jobs: WorkflowJobLike[]) {
  return jobs
    .filter(
      (job) =>
        job.workflow_stage && WORKFLOW_STAGES.has(job.workflow_stage as WorkflowStage),
    )
    .sort((a, b) => {
      const left = a.created_at ? Date.parse(a.created_at) : 0;
      const right = b.created_at ? Date.parse(b.created_at) : 0;
      return right - left;
    });
}

function latestByJobType(jobs: WorkflowJobLike[]) {
  const latest = new Map<string, WorkflowJobLike>();
  for (const job of scopedJobs(jobs)) {
    const key = job.job_type ?? job.workflow_stage ?? job.id ?? 'unknown';
    if (!latest.has(key)) latest.set(key, job);
  }
  return [...latest.values()];
}

export function currentWorkflowFailures(jobs: WorkflowJobLike[]) {
  return latestByJobType(jobs).filter((job) => job.status === 'failed');
}

export function currentWorkflowActiveJobs(jobs: WorkflowJobLike[]) {
  return latestByJobType(jobs).filter((job) =>
    ['queued', 'running', 'waiting_approval'].includes(job.status),
  );
}

export function humanizeKey(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function wordCount(value: unknown) {
  return typeof value === 'string'
    ? value.trim().split(/\s+/).filter(Boolean).length
    : 0;
}

export function shorten(value: string, maxWords: number) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (wordCount(clean) <= maxWords) return clean;
  const sentence = clean.split(/(?<=[.!?])\s/)[0];
  if (wordCount(sentence) <= maxWords) return sentence.replace(/[.!?]$/, '');
  const clause = clean.split(/\s[—–-]\s|;|,|\sbecause\s|\swhich\s/)[0].trim();
  if (wordCount(clause) <= maxWords && wordCount(clause) >= 3) return clause;
  return `${clean
    .split(' ')
    .slice(0, maxWords)
    .join(' ')
    .replace(/[,.;:]$/, '')}…`;
}

export function isPlaceholder(value: string | null | undefined) {
  return (
    !value ||
    /^\s*unknown\b|human review required|requires human review|^to be determined$|^n\/?a$/i.test(
      value,
    )
  );
}

export function isNearDuplicate(a: string, b: string) {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((item) => item.length > 2),
    );
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return false;
  return (
    [...left].filter((item) => right.has(item)).length /
      Math.min(left.size, right.size) >=
    0.8
  );
}

export function labelFor(item: string, labels: ItemLabel[] | undefined) {
  const hit = labels?.find(
    (label) => label.source.trim().toLowerCase() === item.trim().toLowerCase(),
  );
  return hit?.label ?? shortenForChip(item, BUDGET.chipWords);
}

export function shortenForChip(value: string, maxWords = BUDGET.chipWords) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (wordCount(clean) <= maxWords) return clean;
  const clause = clean
    .split(/\s[—–-]\s|;|,|\sbecause\b|\swhich\b|\swithout\b|\sthat\b|\swhen\b/)[0]
    .trim();
  if (wordCount(clause) >= 2 && wordCount(clause) <= maxWords) return clause;
  return `${clean
    .split(' ')
    .slice(0, Math.max(1, maxWords - 1))
    .join(' ')
    .replace(/[,.;:]$/, '')}…`;
}

export function textFor(
  label: string | undefined,
  canonical: string,
  maxWords: number,
) {
  return label && wordCount(label) <= maxWords ? label : shorten(canonical, maxWords);
}

export function chipsFor(
  items: string[],
  max: number = BUDGET.visibleChips,
  labels?: ItemLabel[],
) {
  const clean = items
    .map((item) => item.trim())
    .filter((item) => item && !isPlaceholder(item));
  return {
    items: clean.slice(0, max).map((item) => labelFor(item, labels)),
    more: Math.max(0, clean.length - max),
  };
}

export function displayLabel(value: unknown): DisplayLabels | undefined {
  return value && typeof value === 'object' ? (value as DisplayLabels) : undefined;
}

export function collateralLabel(value: unknown) {
  const key = typeof value === 'string' ? value : '';
  const labels: Record<string, string> = {
    signup_focused_social_content: 'Social content, sign-up focused',
    personalized_email: 'Personalized email',
    segmented_email_and_community: 'Email and community, by role',
    public_conversation_response: 'Replies in public conversations',
  };
  return labels[key] ?? (humanizeKey(key) || 'Outreach copy');
}

export function motionLabel(value: unknown) {
  const labels: Record<string, string> = {
    b2b: 'Sells to businesses (B2B)',
    b2c: 'Sells to individuals (B2C)',
    b2b2c: 'Serves businesses and individuals',
    community: 'Builds trust in communities',
  };
  return labels[String(value ?? '')] ?? 'Motion pending';
}

export function channelLabel(value: unknown) {
  const labels: Record<string, string> = {
    reddit: 'Reddit',
    community: 'Community',
    email: 'Email',
    linkedin: 'Professional social',
    social: 'Social',
  };
  return labels[String(value ?? '').toLowerCase()] ?? (humanizeKey(value) || 'Channel');
}

export function isFallbackAudience(audience: {
  buying_behavior?: Record<string, unknown> | null;
}) {
  return audience.buying_behavior?.source === 'product_profile_fallback';
}

export function isFallbackText(value: unknown) {
  return (
    typeof value === 'string' &&
    /deterministic fallback|fallback icp|invalid audience shape|fallback route/i.test(
      value,
    )
  );
}

export function formatFollowUp(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const followUp = value as { cadence?: string; steps?: unknown[] };
  if (!followUp.cadence || followUp.cadence === 'human_review_required') return '';
  const count = Array.isArray(followUp.steps) ? followUp.steps.length : 0;
  return `${humanizeKey(followUp.cadence)}${count ? `, ${count} follow-up${count === 1 ? '' : 's'}` : ''}`;
}

export function listDisplay(values: unknown, limit = 4): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === 'string' ? value.trim() : humanizeKey(value)))
    .filter(Boolean)
    .slice(0, limit);
}

export function cleanDraft(value: string, label?: string) {
  if (!label) return value;
  const prefix = `${label}:`;
  return value.trimStart().startsWith(prefix)
    ? value.trimStart().slice(prefix.length).trimStart()
    : value;
}

export type DraftVariant = { label: string | null; body: string };

const LABEL_LINE =
  /^\s*(?:\*\*|__)?\s*for\s+([^*_:\n]+?)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;

export function stripWrappingQuotes(value: string) {
  const text = value.trim();
  return /^['"“].*['"”]$/s.test(text) ? text.slice(1, -1).trim() : text;
}

export function splitDraftVariants(content: string): DraftVariant[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const variants: DraftVariant[] = [];
  let current: DraftVariant = { label: null, body: '' };
  for (const line of lines) {
    const match = line.match(LABEL_LINE);
    if (match) {
      if (current.body.trim() || current.label) variants.push(current);
      current = { label: match[1].trim(), body: '' };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.body.trim() || current.label) variants.push(current);
  return variants
    .map((variant) => ({ ...variant, body: stripWrappingQuotes(variant.body) }))
    .filter((variant) => variant.body);
}

export function pickVariant(
  variants: DraftVariant[],
  channel: string,
  copyType: string,
) {
  const keys: Record<string, RegExp> = {
    reddit: /reddit|community/i,
    community: /community|forum/i,
    email: /email|newsletter/i,
    professional_social: /linkedin|professional|social/i,
  };
  const regex = keys[channel] ?? new RegExp(`${channel}|${copyType}`, 'i');
  const index = Math.max(
    0,
    variants.findIndex((variant) =>
      Boolean(variant.label && regex.test(variant.label)),
    ),
  );
  return {
    main: variants[index] ?? { label: null, body: '' },
    others: variants.filter((_, variantIndex) => variantIndex !== index),
  };
}

export function presentWorkflowJob(job: WorkflowJobLike | undefined) {
  if (!job) return null;
  if (job.status === 'failed') {
    const reason = job.error?.reason ?? job.error?.message;
    return {
      label: 'Needs attention',
      detail: typeof reason === 'string' ? reason : 'This step needs review.',
      actionable: true,
    };
  }
  if (job.status === 'waiting_approval')
    return {
      label: 'Ready for review',
      detail: 'Your approval is needed before Sales OS continues.',
      actionable: false,
    };
  if (job.status === 'queued' || job.status === 'running')
    return {
      label: 'In progress',
      detail: 'Sales OS is working on this step.',
      actionable: false,
    };
  return {
    label: job.status === 'cancelled' ? 'Cancelled' : 'Complete',
    detail:
      job.status === 'cancelled' ? 'This step was cancelled.' : 'This step completed.',
    actionable: job.status === 'cancelled',
  };
}

export function deriveWorkflowSteps(snapshot: WorkflowSnapshot): WorkflowStepView[] {
  const failures = currentWorkflowFailures(snapshot.jobs);
  const active = currentWorkflowActiveJobs(snapshot.jobs);
  const failedStage = new Set(failures.map((job) => job.workflow_stage));
  const activeStage = new Set(active.map((job) => job.workflow_stage));
  return [
    {
      id: 'source',
      label: 'Source',
      status: failedStage.has('product_input')
        ? 'attention'
        : snapshot.hasInput
          ? 'approved'
          : 'review',
      summary: snapshot.hasInput
        ? COPY.summaries.files(snapshot.sourceCount ?? 1)
        : COPY.summaries.addInfo,
      reviewCount: snapshot.hasInput ? 0 : 1,
    },
    {
      id: 'profile',
      label: 'Sales profile',
      status: !snapshot.hasInput
        ? 'locked'
        : failedStage.has('profile_review')
          ? 'attention'
          : snapshot.profileStatus === 'approved'
            ? 'approved'
            : snapshot.hasProfile
              ? 'review'
              : activeStage.has('profile_review')
                ? 'working'
                : 'review',
      summary:
        snapshot.profileStatus === 'approved'
          ? COPY.summaries.version(snapshot.profileVersion ?? 1)
          : snapshot.hasProfile
            ? `${COPY.summaries.version(snapshot.profileVersion ?? 1)} to review`
            : activeStage.has('profile_review')
              ? COPY.empty.profileWorking
              : 'Not started',
      reviewCount: snapshot.profileStatus === 'approved' ? 0 : 1,
    },
    {
      id: 'audiences',
      label: 'Audiences',
      status:
        snapshot.profileStatus !== 'approved'
          ? 'locked'
          : failedStage.has('strategy_generation')
            ? 'attention'
            : snapshot.hasProposedAudience
              ? 'review'
              : snapshot.hasApprovedAudience
                ? 'approved'
                : activeStage.has('strategy_generation')
                  ? 'working'
                  : 'review',
      summary: snapshot.hasProposedAudience
        ? COPY.summaries.toReview(snapshot.audienceReviewCount ?? 1)
        : snapshot.hasApprovedAudience
          ? COPY.summaries.audiences(snapshot.approvedAudienceCount ?? 1)
          : activeStage.has('strategy_generation')
            ? COPY.empty.audiencesWorking
            : 'Not started',
      reviewCount:
        snapshot.audienceReviewCount ?? (snapshot.hasProposedAudience ? 1 : 0),
    },
    {
      id: 'outreach',
      label: 'Outreach',
      status: !snapshot.hasApprovedAudience
        ? 'locked'
        : snapshot.hasProposedDecision
          ? 'review'
          : snapshot.hasApprovedDecision
            ? 'approved'
            : activeStage.has('outreach_review')
              ? 'working'
              : 'review',
      summary: snapshot.hasProposedDecision
        ? COPY.summaries.toReview(snapshot.decisionReviewCount ?? 1)
        : snapshot.hasApprovedDecision
          ? `${snapshot.approvedDecisionCount ?? 1} approved`
          : 'Not started',
      reviewCount:
        snapshot.decisionReviewCount ?? (snapshot.hasProposedDecision ? 1 : 0),
    },
    {
      id: 'copy',
      label: 'Copy',
      status: !snapshot.hasApprovedDecision
        ? 'locked'
        : failedStage.has('copy_generation')
          ? 'attention'
          : snapshot.awaitingCopyCount > 0
            ? 'review'
            : snapshot.approvedCopyCount > 0 &&
                snapshot.approvedCopyCount === snapshot.copyCount
              ? 'approved'
              : snapshot.approvedCopyCount > 0 && snapshot.awaitingCopyCount === 0
                ? 'approved'
                : snapshot.copyCount === 0
                  ? 'working'
                  : activeStage.has('copy_generation')
                    ? 'working'
                    : 'review',
      summary:
        snapshot.awaitingCopyCount > 0
          ? COPY.summaries.toReview(snapshot.awaitingCopyCount)
          : snapshot.approvedCopyCount > 0
            ? COPY.summaries.approved(snapshot.approvedCopyCount)
            : snapshot.copyCount
              ? COPY.empty.copyWorking
              : 'Not started',
      reviewCount: snapshot.awaitingCopyCount,
    },
  ];
}

export function defaultActiveStep(steps: WorkflowStepView[]) {
  return (
    steps.find((step) => step.status === 'attention')?.id ??
    steps.find((step) => step.status === 'review')?.id ??
    steps.find((step) => step.status !== 'locked')?.id ??
    'source'
  );
}

export type NextUp = {
  tone: 'attention' | 'review' | 'waiting' | 'done';
  title: string;
  body: string;
  actionLabel: string;
  targetStep: WorkflowStepView['id'];
};

export function deriveNextUp(
  steps: WorkflowStepView[],
  jobs: WorkflowJobLike[] = [],
): NextUp {
  const attention = steps.find((step) => step.status === 'attention');
  if (attention)
    return {
      tone: 'attention',
      title: `${attention.label} didn't finish`,
      body:
        presentWorkflowJob(
          currentWorkflowFailures(jobs).find(
            (job) =>
              job.workflow_stage ===
              (
                {
                  source: 'product_input',
                  profile: 'profile_review',
                  audiences: 'strategy_generation',
                  outreach: 'outreach_review',
                  copy: 'copy_generation',
                } as Record<string, string>
              )[attention.id],
          ),
        )?.detail ?? 'Review this step before continuing.',
      actionLabel: 'Review step',
      targetStep: attention.id,
    };
  const review = steps.find((step) => step.status === 'review');
  if (review)
    return {
      tone: 'review',
      title:
        review.id === 'source'
          ? 'Add product information'
          : review.id === 'profile'
            ? 'Review the sales profile'
            : review.id === 'audiences'
              ? `Review ${review.reviewCount} audience${review.reviewCount === 1 ? '' : 's'}`
              : review.id === 'outreach'
                ? `Approve ${review.reviewCount} channel${review.reviewCount === 1 ? '' : 's'}`
                : `Review ${review.reviewCount} draft${review.reviewCount === 1 ? '' : 's'}`,
      body:
        review.id === 'source'
          ? 'Upload a file or type a short brief to get started.'
          : review.id === 'profile'
            ? 'Approve it to generate audiences.'
            : review.id === 'audiences'
              ? 'Approve the ones you want to reach.'
              : review.id === 'outreach'
                ? 'Copy is drafted after you approve a channel.'
                : 'Approve or request changes.',
      actionLabel:
        review.id === 'source'
          ? 'Add information'
          : review.id === 'profile'
            ? 'Review profile'
            : review.id === 'audiences'
              ? 'Review audiences'
              : review.id === 'outreach'
                ? 'Review channels'
                : 'Review drafts',
      targetStep: review.id,
    };
  const working = steps.find((step) => step.status === 'working');
  if (working)
    return {
      tone: 'waiting',
      title: `Working on ${working.label}`,
      body: 'This updates automatically.',
      actionLabel: `View ${working.label.toLowerCase()}`,
      targetStep: working.id,
    };
  return {
    tone: 'done',
    title: 'Everything is approved',
    body: 'Your copy is ready to post.',
    actionLabel: 'View copy',
    targetStep: 'copy',
  };
}

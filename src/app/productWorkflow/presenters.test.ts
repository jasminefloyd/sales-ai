import { describe, expect, it } from 'vitest';
import {
  collateralLabel,
  formatFollowUp,
  humanizeKey,
  isFallbackText,
  currentWorkflowFailures,
  deriveNextUp,
  deriveWorkflowSteps,
  splitDraftVariants,
  pickVariant,
  shortenForChip,
  splitDecisionsByVersion,
} from './presenters';

describe('product workflow presenters', () => {
  it('humanizes camel, snake, and uppercase keys', () => {
    expect(humanizeKey('primaryEvent')).toBe('Primary Event');
    expect(humanizeKey('signup_focused_social_content')).toBe(
      'Signup Focused Social Content',
    );
    expect(humanizeKey('PRIMARYEVENT')).toBe('PRIMARYEVENT');
  });
  it('formats follow-up data without object coercion', () => {
    expect(formatFollowUp(null)).toBe('');
    expect(formatFollowUp({ cadence: 'weekly', steps: [{ action: 'email' }] })).toBe(
      'Weekly, 1 follow-up',
    );
  });
  it('recognizes fallback text and labels collateral', () => {
    expect(isFallbackText('Deterministic fallback route')).toBe(true);
    expect(collateralLabel('signup_focused_social_content')).toBe(
      'Social content, sign-up focused',
    );
  });
  it('uses the latest failure per job type', () => {
    const failures = currentWorkflowFailures([
      {
        id: 'old',
        job_type: 'analysis',
        workflow_stage: 'strategy_generation',
        status: 'failed',
        created_at: '2026-01-01',
      },
      {
        id: 'new',
        job_type: 'analysis',
        workflow_stage: 'strategy_generation',
        status: 'failed',
        created_at: '2026-01-02',
      },
      {
        id: 'ignored',
        job_type: 'learning_analysis',
        workflow_stage: 'learning',
        status: 'failed',
        created_at: '2026-01-03',
      },
    ]);
    expect(failures.map((job) => job.id)).toEqual(['new']);
    expect(
      currentWorkflowFailures([
        {
          id: 'failed',
          job_type: 'analysis',
          workflow_stage: 'strategy_generation',
          status: 'failed',
          created_at: '2026-01-01',
        },
        {
          id: 'completed',
          job_type: 'analysis',
          workflow_stage: 'strategy_generation',
          status: 'completed',
          created_at: '2026-01-02',
        },
      ]),
    ).toEqual([]);
  });
  it('separates current audience decisions from earlier versions', () => {
    const result = splitDecisionsByVersion(
      [
        { id: 'v1', audience_id: 'a', audience_version: 1, status: 'approved' },
        { id: 'v2', audience_id: 'a', audience_version: 2, status: 'proposed' },
        { id: 'rejected', audience_id: 'a', audience_version: 2, status: 'rejected' },
      ],
      [{ id: 'a', audience_version: 2 }],
    );
    expect(result.current.map((item) => item.id)).toEqual(['v2']);
    expect(result.earlier.map((item) => item.id)).toEqual(['v1', 'rejected']);
  });
  it('keeps outreach in review while any current channel is proposed', () => {
    const steps = deriveWorkflowSteps({
      hasInput: true,
      hasProfile: true,
      profileStatus: 'approved',
      hasProposedAudience: false,
      hasApprovedAudience: true,
      hasProposedDecision: true,
      hasApprovedDecision: true,
      copyCount: 0,
      awaitingCopyCount: 0,
      approvedCopyCount: 0,
      jobs: [],
    });
    expect(steps.find((step) => step.id === 'outreach')?.status).toBe('review');
    expect(deriveNextUp(steps).targetStep).toBe('outreach');
  });
  it('marks copy approved when all available copy is approved', () => {
    const steps = deriveWorkflowSteps({
      hasInput: true,
      hasProfile: true,
      profileStatus: 'approved',
      hasProposedAudience: false,
      hasApprovedAudience: true,
      hasProposedDecision: false,
      hasApprovedDecision: true,
      copyCount: 1,
      awaitingCopyCount: 0,
      approvedCopyCount: 1,
      jobs: [],
    });
    expect(steps.find((step) => step.id === 'copy')).toMatchObject({
      status: 'approved',
      summary: '1 approved',
    });
  });
  it('shortens old long chips at a useful phrase boundary', () => {
    expect(shortenForChip('Lost sales when buyers cannot pay by card')).toBe(
      'Lost sales',
    );
    expect(
      shortenForChip(
        'Artists lack a professional online presence to be discovered by collectors',
      ),
    ).toBe('Artists lack a professional…');
  });
  it('selects one channel draft and keeps other labeled versions separate', () => {
    const variants = splitDraftVariants(
      '**For Reddit/Artist Community Posts:**\n"Reddit body"\n\nFor Instagram Caption:\n"Instagram body"\n\nFor Art Community Newsletter Mention:\n"Newsletter body"',
    );
    const selected = pickVariant(variants, 'reddit', 'community_post');
    expect(selected.main.label).toBe('Reddit/Artist Community Posts');
    expect(selected.main.body).toBe('Reddit body');
    expect(selected.others).toHaveLength(2);
  });
});

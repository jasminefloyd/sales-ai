import { describe, expect, it } from 'vitest';
import {
  presentAudience,
  presentDecision,
  presentIcp,
  presentProfile,
  presentSource,
} from './viewModels';

describe('product workflow card presenters', () => {
  it('keeps long profile text in explain and limits glance chips', () => {
    const view = presentProfile({
      category: 'Sales intelligence and revenue operations',
      description:
        'A long product description that should remain available to reviewers in the explanation layer.',
      problems_solved: ['One', 'Two', 'Three', 'Four'],
      primary_use_cases: ['Use one'],
      source_evidence: [{ source: 'brief' }],
      review_status: 'needs_review',
    });
    expect(view.glance.chips?.items).toHaveLength(4);
    expect(view.explain?.fullText?.[0][1]).toContain('long product description');
  });

  it('removes duplicate decision goals from the glance', () => {
    const view = presentDecision(
      {
        channel: 'email',
        objective: 'Help sales teams lose less deal context',
        status: 'proposed',
      },
      { audienceProblem: 'Help sales teams lose less deal context' },
    );
    expect(view.glance.line).toBeUndefined();
    expect(view.audit.some(([label]) => label === 'Objective')).toBe(true);
  });

  it('keeps ICP and audience explanations available while hiding duplicate audience context', () => {
    const icp = presentIcp({
      name: 'Sales teams',
      summary: 'Teams need deal clarity',
      core_problem: 'Teams need deal clarity',
      is_primary: true,
      validation_status: 'pending_review',
    });
    const audience = presentAudience(
      {
        name: 'Sales teams',
        problem_use_case_fit: 'Teams need deal clarity',
        status: 'proposed',
        purchase_triggers: ['New opportunity'],
      },
      { parentIcpSummary: 'Teams need deal clarity' },
    );
    expect(icp.glance.badges).toHaveLength(2);
    expect(audience.glance.subtitle).toBeUndefined();
    expect(audience.explain?.fullText?.[0][0]).toBe('Problem');
  });

  it('renders complete audience sentences instead of stored truncated labels', () => {
    const view = presentAudience({
      name: 'Teams facing no affordable, automated way to monitor…',
      problem_use_case_fit: 'No affordable, automated way to monitor local competitors',
      status: 'approved',
      purchase_triggers: [
        'Owner preparing for seasonal demand changes before competitors respond',
        'New competitor opens nearby and changes local pricing expectations',
      ],
      display_labels: {
        name: 'No affordable, automated way to monitor…',
        purchaseTriggers: [
          {
            source:
              'Owner preparing for seasonal demand changes before competitors respond',
            label: 'Owner preparing for seasonal…',
          },
        ],
      },
    });
    expect(view.glance.title).toBe(
      'No affordable, automated way to monitor local competitors',
    );
    expect(view.glance.subtitle).toBe(
      'No affordable, automated way to monitor local competitors',
    );
    expect(view.glance.chips?.items).toEqual([
      'Owner preparing for seasonal demand changes before competitors respond',
      'New competitor opens nearby and changes local pricing expectations',
    ]);
    expect(view.glance.chips?.more).toBe(0);
  });

  it('presents source metadata as audit information', () => {
    const view = presentSource({
      file_name: 'brief.md',
      source_type: 'markdown',
      parse_status: 'parsed',
      content: 'hello',
    });
    expect(view.glance.badges[0].label).toBe('Parsed');
    expect(view.audit).toContainEqual(['Characters', '5']);
  });
});

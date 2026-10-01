import type { ProductWorkflowState } from './workflowState';

export type WorkflowJobStatus =
  | 'queued'
  | 'running'
  | 'paused_budget'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export function presentWorkflowJob(input: {
  status: WorkflowJobStatus;
  workflowState: ProductWorkflowState;
  error?: Record<string, unknown> | null;
}) {
  if (input.status === 'failed') {
    return {
      label: 'Needs attention',
      detail: String(
        input.error?.reason ?? 'The workflow step failed. Retry or update the input.',
      ),
      actionable: true,
    };
  }
  if (input.status === 'paused_budget') {
    return {
      label: 'Paused',
      detail: 'Waiting for budget approval before continuing.',
      actionable: true,
    };
  }
  if (input.status === 'waiting_approval') {
    return {
      label: 'Ready for review',
      detail: 'A human approval is required before the workflow continues.',
      actionable: false,
    };
  }
  if (['queued', 'running'].includes(input.status)) {
    return {
      label: 'In progress',
      detail: `Sales OS is working on ${input.workflowState.replaceAll('_', ' ')}.`,
      actionable: false,
    };
  }
  return {
    label: input.status === 'cancelled' ? 'Cancelled' : 'Complete',
    detail:
      input.status === 'cancelled'
        ? 'This step was cancelled.'
        : 'This step completed.',
    actionable: input.status === 'cancelled',
  };
}

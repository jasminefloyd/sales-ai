export const productWorkflowStates = [
  'needs_input',
  'importing',
  'parsing',
  'profile_review',
  'generating_strategy',
  'outreach_review',
  'generating_copy',
  'copy_ready',
  'complete',
  'error',
] as const;

export type ProductWorkflowState = (typeof productWorkflowStates)[number];

export type ProductWorkflowSnapshot = {
  productStatus: string;
  hasInput: boolean;
  hasProfile: boolean;
  profileApproved: boolean;
  activeJobCount?: number;
  failedJobCount?: number;
  proposedOutreachCount?: number;
  approvedOutreachCount?: number;
  generatedCopyCount?: number;
  pendingCopyApprovalCount?: number;
};

export type ProductWorkflowView = {
  state: ProductWorkflowState;
  label: string;
  nextAction: string;
};

const workflowViews: Record<
  ProductWorkflowState,
  Omit<ProductWorkflowView, 'state'>
> = {
  needs_input: {
    label: 'Needs product information',
    nextAction: 'Import a file or enter product information.',
  },
  importing: {
    label: 'Importing',
    nextAction: 'Wait for the source material to finish importing.',
  },
  parsing: {
    label: 'Parsing product information',
    nextAction: 'Wait while Sales OS builds the Product Sales Profile.',
  },
  profile_review: {
    label: 'Review Product Sales Profile',
    nextAction: 'Review and approve the Product Sales Profile.',
  },
  generating_strategy: {
    label: 'Generating strategy',
    nextAction:
      'Wait while Sales OS generates ICPs, audiences, and outreach decisions.',
  },
  outreach_review: {
    label: 'Review outreach decisions',
    nextAction: 'Approve one or more recommended outreach decisions.',
  },
  generating_copy: {
    label: 'Generating copy',
    nextAction: 'Wait while Sales OS creates copy for the approved outreach decisions.',
  },
  copy_ready: {
    label: 'Copy ready for review',
    nextAction: 'Review and edit the generated copy.',
  },
  complete: {
    label: 'Workflow complete',
    nextAction: 'Review the approved product copy or update the strategy.',
  },
  error: {
    label: 'Needs attention',
    nextAction: 'Review the failed step and retry or update the input.',
  },
};

/**
 * Derives the user-facing workflow state from product-scoped records.
 * This deliberately does not expose database/job statuses to the UI.
 */
export function deriveProductWorkflowView(
  snapshot: ProductWorkflowSnapshot,
): ProductWorkflowView {
  const activeJobs = snapshot.activeJobCount ?? 0;
  const failedJobs = snapshot.failedJobCount ?? 0;
  const proposedOutreach = snapshot.proposedOutreachCount ?? 0;
  const approvedOutreach = snapshot.approvedOutreachCount ?? 0;
  const generatedCopy = snapshot.generatedCopyCount ?? 0;
  const pendingCopyApproval = snapshot.pendingCopyApprovalCount ?? 0;

  let state: ProductWorkflowState;
  if (failedJobs > 0 && activeJobs === 0) state = 'error';
  else if (!snapshot.hasInput) state = 'needs_input';
  else if (snapshot.productStatus === 'draft' && activeJobs > 0) state = 'importing';
  else if (['draft', 'analyzing'].includes(snapshot.productStatus)) state = 'parsing';
  else if (snapshot.hasProfile && !snapshot.profileApproved) state = 'profile_review';
  else if (activeJobs > 0 && approvedOutreach === 0) state = 'generating_strategy';
  else if (proposedOutreach > 0) state = 'outreach_review';
  else if (approvedOutreach > 0 && generatedCopy === 0) state = 'generating_copy';
  else if (generatedCopy > 0 || pendingCopyApproval > 0) state = 'copy_ready';
  else state = 'complete';

  return { state, ...workflowViews[state] };
}

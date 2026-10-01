export type WorkflowStepId = 'source' | 'profile' | 'audiences' | 'outreach' | 'copy';

export type ItemLabel = { label: string; source: string };
export type DisplayLabels = {
  schemaVersion?: number;
  category?: string;
  description?: string;
  name?: string;
  summary?: string;
  whyItFits?: string;
  problem?: string;
  goal?: string;
  why?: string;
  problemsSolved?: ItemLabel[];
  primaryUseCases?: ItemLabel[];
  competitiveAlternatives?: ItemLabel[];
  purchaseFriction?: ItemLabel[];
  purchaseTriggers?: ItemLabel[];
  conversionEvent?: Record<string, string>;
};

export type WorkflowStep = {
  id: WorkflowStepId;
  label: string;
  status: 'locked' | 'working' | 'review' | 'attention' | 'approved';
  complete: boolean;
  summary?: string;
  reviewCount?: number;
};

export type NextUpView = {
  tone: 'attention' | 'review' | 'waiting' | 'done';
  title: string;
  body: string;
  actionLabel: string;
  targetStep: WorkflowStepId;
};

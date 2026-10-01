const labels: Record<string, string> = {
  needs_input: 'Needs product information',
  importing: 'Importing',
  parsing: 'Parsing product information',
  profile_review: 'Review Product Sales Profile',
  generating_strategy: 'Generating strategy',
  outreach_review: 'Review outreach decisions',
  generating_copy: 'Generating copy',
  copy_ready: 'Copy ready for review',
  complete: 'Workflow complete',
  error: 'Needs attention',
  draft: 'Draft',
  analyzing: 'Analyzing…',
  audience_review: 'Needs audience review',
  active: 'Active',
  paused: 'Paused',
  proposed: 'Proposed',
  approved: 'Approved',
  rejected: 'Rejected',
  awaiting_review: 'Needs review',
  engagement_pending: 'Draft ready',
  awaiting_approval: 'Needs your approval',
  blocked_by_check: 'Fix 1 check',
  engaged: 'Sent',
  queued: 'Draft ready',
  responded: 'Replied',
  converted: 'Converted',
  closed: 'Closed',
  detected: 'Detected',
  paused_budget: 'Paused at cap',
  waiting_approval: 'Needs your approval',
  running: 'Running',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function displayStatus(value: string | null | undefined): string {
  if (!value) return '';
  return (
    labels[value] ??
    value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function displayRoute(value: string | null | undefined): string {
  if (!value) return '';
  return value === 'social_community'
    ? 'Community'
    : value === 'direct'
      ? 'Direct'
      : displayStatus(value);
}

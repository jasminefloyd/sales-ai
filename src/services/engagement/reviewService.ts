import { supabaseBrowserClient } from '../../lib/supabase/browser';

export type EngagementReviewAction = 'approve' | 'edit_approve' | 'reject';

export async function reviewEngagement(input: {
  engagementId: string;
  action: EngagementReviewAction;
  finalContent?: string;
  reviewNotes?: string;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-review-engagement',
    { body: input },
  );
  if (error) throw error;
  return data;
}

export async function completeManualEngagement(input: {
  engagementId: string;
  externalMessageId?: string;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-complete-manual-engagement',
    { body: input },
  );
  if (error) throw error;
  return data;
}

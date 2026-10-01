import { supabaseBrowserClient } from '../../lib/supabase/browser';

export type OutreachDecisionReviewAction = 'approve' | 'reject' | 'pause';

export async function reviewOutreachDecision(input: {
  decisionId: string;
  action: OutreachDecisionReviewAction;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-review-outreach-decision',
    { body: input },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.data;
}

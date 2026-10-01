import { supabaseBrowserClient } from '../../lib/supabase/browser';
import { runSalesOsWorker } from '../jobs/workerService';

export type OpportunityReviewAction = 'approve' | 'reject' | 'request_draft';

export async function reviewOpportunity(input: {
  opportunityId: string;
  action: OpportunityReviewAction;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-review-opportunity',
    { body: input },
  );
  if (error) throw error;
  if (input.action === 'request_draft') await runSalesOsWorker();
  return data;
}

import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function reviewIdentity(input: {
  action: 'approve' | 'reject' | 'revert';
  candidateId?: string;
  mergeId?: string;
  reviewNotes?: string;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-review-identity',
    { body: input },
  );
  if (error) throw error;
  return data;
}

import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function reviewLearning(input: {
  learningId: string;
  action: 'approve' | 'reject';
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-review-learning',
    { body: input },
  );
  if (error) throw error;
  return data;
}

import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function reviewIntentScore(input: {
  scoreId: string;
  action: 'override' | 'clear_override';
  score?: number;
  reason?: string;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-review-intent',
    { body: input },
  );
  if (error) throw error;
  return data;
}

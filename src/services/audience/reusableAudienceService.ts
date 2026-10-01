import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function refreshAudienceDefinition(input: {
  action: 'preview' | 'refresh';
  productId: string;
  definitionId: string;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-refresh-audience',
    { body: input },
  );
  if (error) throw error;
  return data as {
    preview?: { total: number; matching: number; wouldRemove: number };
    queued?: boolean;
    jobId?: string | null;
  };
}

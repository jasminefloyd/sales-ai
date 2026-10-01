import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function updateSalesOsSettings(input: Record<string, unknown>) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-settings',
    { body: input },
  );
  if (error) throw error;
  return data;
}

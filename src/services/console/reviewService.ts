import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function executeConsoleRequest(input: {
  tool: string;
  productId: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-console',
    {
      body: input,
    },
  );
  if (error) throw error;
  return data;
}

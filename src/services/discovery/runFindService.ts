import { supabaseBrowserClient } from '../../lib/supabase/browser';
import { runSalesOsWorker } from '../jobs/workerService';

export async function requestFind(input: {
  productId: string;
  audienceId: string;
  routeId: string;
  query?: string;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-run-find',
    {
      body: input,
    },
  );
  if (error) throw error;
  await runSalesOsWorker();
  return data;
}

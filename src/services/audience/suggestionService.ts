import { supabaseBrowserClient } from '../../lib/supabase/browser';
import { runSalesOsWorker } from '../jobs/workerService';

export async function suggestAudience(input: {
  productId: string;
  suggestion: string;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-suggest-audience',
    { body: input },
  );
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      let payload: { error?: unknown } | null = null;
      try {
        payload = (await response.clone().json()) as { error?: unknown };
      } catch {
        payload = null;
      }
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        throw new Error(payload.error);
      }
    }
    throw error;
  }
  await runSalesOsWorker();
  return data;
}

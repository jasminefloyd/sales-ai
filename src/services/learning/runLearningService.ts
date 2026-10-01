import { supabaseBrowserClient } from '../../lib/supabase/browser';
import { runSalesOsWorker } from '../jobs/workerService';

export async function requestLearningAnalysis(input: {
  productId: string;
  minimumSampleSize?: number;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-run-learning-analysis',
    { body: input },
  );
  if (error) throw error;
  await runSalesOsWorker();
  return data;
}

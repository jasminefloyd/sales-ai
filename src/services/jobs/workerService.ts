import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function runSalesOsWorker() {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-worker',
    {
      body: { maxJobs: 5 },
    },
  );
  if (error) throw error;
  const result = data as { processed: number; jobs: Array<Record<string, unknown>> };
  const failedJob = result.jobs?.find((job) => job.status === 'failed');
  if (failedJob) {
    throw new Error(
      String(failedJob.error ?? failedJob.reason ?? 'Sales OS worker failed.'),
    );
  }
  return result;
}

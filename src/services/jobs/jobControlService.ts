import { supabaseBrowserClient } from '../../lib/supabase/browser';
import { runSalesOsWorker } from './workerService';

export async function controlJob(input: {
  action: 'cancel' | 'resume' | 'retry' | 'mark_stale';
  jobId?: string;
  staleMinutes?: number;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-job-control',
    { body: input },
  );
  if (error) throw error;
  // Job control only changes queue state. Run the worker here for interactive
  // retry/resume actions so the UI does not leave the job queued indefinitely.
  if (input.action === 'retry' || input.action === 'resume') {
    await runSalesOsWorker();
  }
  return data;
}

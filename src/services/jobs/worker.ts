import type { SupabaseClient } from '@supabase/supabase-js';

import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  pauseJob,
} from './jobService';

export type WorkerJob = {
  id: string;
  job_type: string;
  input: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
};

export type JobExecutionResult = {
  result?: Record<string, unknown>;
  actualCost?: number;
};

export interface JobExecutor {
  supports(jobType: string): boolean;
  execute(job: WorkerJob, signal: AbortSignal): Promise<JobExecutionResult>;
}

export interface JobRuntime {
  claim(workerId: string): Promise<WorkerJob | null>;
  heartbeat(
    jobId: string,
    workerId: string,
    progress?: Record<string, unknown>,
  ): Promise<unknown>;
  complete(
    jobId: string,
    workerId: string,
    result?: Record<string, unknown>,
    actualCost?: number,
  ): Promise<unknown>;
  fail(
    jobId: string,
    workerId: string,
    error: Record<string, unknown>,
  ): Promise<unknown>;
  pause(
    jobId: string,
    workerId: string,
    reason: 'budget' | 'approval',
    details?: Record<string, unknown>,
  ): Promise<unknown>;
}

export function createSupabaseJobRuntime(client: SupabaseClient): JobRuntime {
  return {
    claim: (workerId) => claimNextJob(client, workerId),
    heartbeat: (jobId, workerId, progress) =>
      heartbeatJob(client, { jobId, workerId, progress }),
    complete: (jobId, workerId, result, actualCost) =>
      completeJob(client, { jobId, workerId, result, actualCost }),
    fail: (jobId, workerId, error) => failJob(client, { jobId, workerId, error }),
    pause: (jobId, workerId, reason, details) =>
      pauseJob(client, { jobId, workerId, reason, details }),
  };
}

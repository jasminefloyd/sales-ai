import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused_budget'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export function buildJobIdempotencyKey(input: {
  productId: string;
  jobType: string;
  scope: string;
}) {
  return `${SALES_OS_TENANT_ID}:${input.productId}:${input.jobType}:${input.scope}`;
}

export function buildJobInsert(input: {
  productId: string;
  jobType:
    | 'product_analysis'
    | 'audience_discovery'
    | 'audience_enrichment'
    | 'audience_quality'
    | 'audience_refresh'
    | 'find'
    | 'engagement_batch'
    | 'learning_analysis'
    | 'attribution'
    | 'console_action';
  payload: Record<string, unknown>;
  actor: string;
  idempotencyKey: string;
  estimatedCost?: number;
  maxAttempts?: number;
  nextRunAt?: string;
}) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    job_type: input.jobType,
    status: 'queued' as const,
    input: input.payload,
    progress: { stage: 'queued' },
    result: {},
    estimated_cost: input.estimatedCost ?? null,
    max_attempts: input.maxAttempts ?? 3,
    next_run_at: input.nextRunAt ?? null,
    idempotency_key: input.idempotencyKey,
    created_by: input.actor,
    updated_by: input.actor,
    state_changed_by: input.actor,
  };
}

export function shouldRetryJob(input: {
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
  externalEngagement: boolean;
  ambiguousExternalResult?: boolean;
}) {
  return (
    input.retryable &&
    !input.externalEngagement &&
    !input.ambiguousExternalResult &&
    input.attempt < input.maxAttempts
  );
}

export function retryDelayMs(attempt: number, baseMs = 30_000) {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

export async function persistJob(
  client: SupabaseClient,
  input: Parameters<typeof buildJobInsert>[0],
) {
  const { data, error } = await client
    .from('sales_os_jobs')
    .upsert(buildJobInsert(input), {
      onConflict: 'tenant_id,product_id,idempotency_key',
      ignoreDuplicates: true,
    })
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const existing = await client
    .from('sales_os_jobs')
    .select()
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('product_id', input.productId)
    .eq('idempotency_key', input.idempotencyKey)
    .single();
  if (existing.error) throw existing.error;
  return existing.data;
}

export async function claimNextJob(client: SupabaseClient, workerId: string) {
  const { data, error } = await client.rpc('sales_os_claim_next_job', {
    p_worker_id: workerId,
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function heartbeatJob(
  client: SupabaseClient,
  input: { jobId: string; workerId: string; progress?: Record<string, unknown> },
) {
  const { data, error } = await client
    .from('sales_os_jobs')
    .update({
      last_heartbeat_at: new Date().toISOString(),
      ...(input.progress ? { progress: input.progress } : {}),
      updated_by: input.workerId,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', input.jobId)
    .eq('status', 'running')
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function completeJob(
  client: SupabaseClient,
  input: {
    jobId: string;
    workerId: string;
    result?: Record<string, unknown>;
    actualCost?: number;
  },
) {
  const { data, error } = await client
    .from('sales_os_jobs')
    .update({
      status: 'completed',
      result: input.result ?? {},
      actual_cost: input.actualCost ?? 0,
      last_heartbeat_at: new Date().toISOString(),
      updated_by: input.workerId,
      state_changed_by: input.workerId,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', input.jobId)
    .eq('status', 'running')
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function failJob(
  client: SupabaseClient,
  input: {
    jobId: string;
    workerId: string;
    error: Record<string, unknown>;
    retryAt?: string;
  },
) {
  const nextStatus: JobStatus = input.retryAt ? 'failed' : 'failed';
  const { data, error } = await client
    .from('sales_os_jobs')
    .update({
      status: nextStatus,
      error: input.error,
      ...(input.retryAt ? { next_run_at: input.retryAt } : {}),
      updated_by: input.workerId,
      state_changed_by: input.workerId,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', input.jobId)
    .eq('status', 'running')
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function pauseJob(
  client: SupabaseClient,
  input: {
    jobId: string;
    workerId: string;
    reason: 'budget' | 'approval';
    details?: Record<string, unknown>;
  },
) {
  const status = input.reason === 'budget' ? 'paused_budget' : 'waiting_approval';
  const { data, error } = await client
    .from('sales_os_jobs')
    .update({
      status,
      error: { reason: input.reason, ...(input.details ?? {}) },
      updated_by: input.workerId,
      state_changed_by: input.workerId,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', input.jobId)
    .eq('status', 'running')
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelJob(
  client: SupabaseClient,
  input: { jobId: string; actor: string },
) {
  const { data, error } = await client
    .from('sales_os_jobs')
    .update({
      status: 'cancelled',
      cancel_requested: true,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', input.jobId)
    .in('status', ['queued', 'running', 'paused_budget', 'waiting_approval', 'failed'])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function resumeJob(
  client: SupabaseClient,
  input: { jobId: string; actor: string },
) {
  const { data, error } = await client
    .from('sales_os_jobs')
    .update({
      status: 'queued',
      cancel_requested: false,
      error: null,
      next_run_at: new Date().toISOString(),
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', input.jobId)
    .in('status', ['paused_budget', 'waiting_approval', 'failed'])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markStaleJobs(
  client: SupabaseClient,
  input: { staleBefore: string; actor: string },
) {
  const { data, error } = await client
    .from('sales_os_jobs')
    .update({
      status: 'failed',
      error: { reason: 'stale_heartbeat' },
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('status', 'running')
    .lt('last_heartbeat_at', input.staleBefore)
    .select();
  if (error) throw error;
  return data ?? [];
}

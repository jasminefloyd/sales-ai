import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';
import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import { buildSocialSearchPlan, SocialCandidateSchema } from './social';
import { buildJobIdempotencyKey, persistJob } from '../jobs/jobService';
import { assertApprovedFindRoute } from './routeGuard';

export function buildFindJobInsert(input: {
  productId: string;
  audienceId?: string;
  routeId?: string;
  searchPlan: Record<string, unknown>;
  actor: string;
}) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: input.productId,
    job_type: 'find',
    status: 'queued',
    input: {
      audienceId: input.audienceId ?? null,
      routeId: input.routeId ?? null,
      searchPlan: input.searchPlan,
    },
    progress: { stage: 'queued', discovered: 0, qualified: 0, rejected: 0 },
    result: {},
    created_by: input.actor,
    updated_by: input.actor,
  };
}

export async function createFindJob(
  client: SupabaseClient,
  input: Parameters<typeof buildFindJobInsert>[0],
) {
  return persistJob(client, {
    productId: input.productId,
    jobType: 'find',
    payload: {
      audienceId: input.audienceId ?? null,
      routeId: input.routeId ?? null,
      searchPlan: input.searchPlan,
    },
    actor: input.actor,
    idempotencyKey: buildJobIdempotencyKey({
      productId: input.productId,
      jobType: 'find',
      scope: input.audienceId ?? input.routeId ?? 'product',
    }),
  });
}

export async function runSocialFind(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    searchContext: Parameters<typeof buildSocialSearchPlan>[0];
    audienceId: string;
    routeId: string;
  },
) {
  await assertApprovedFindRoute(client, {
    productId: input.productId,
    audienceId: input.audienceId,
    routeId: input.routeId,
  });
  const { error: startError } = await client
    .from('sales_os_jobs')
    .update({
      status: 'running',
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', input.jobId)
    .eq('status', 'queued');
  if (startError) throw startError;

  const searchPlan = buildSocialSearchPlan(input.searchContext);
  const context: ProviderExecutionContext = {
    productId: input.productId,
    jobId: input.jobId,
    estimatedCost: input.estimatedCost,
    actor: input.actor,
  };
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'searchCommunity',
    { searchPlan },
    context,
  );
  if (result.status !== 'executed' || !result.result.success)
    return { ...result, searchPlan };

  const rawCandidates = Array.isArray(result.result.data) ? result.result.data : [];
  const candidates = rawCandidates.flatMap((candidate) => {
    const parsed = SocialCandidateSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
  return { ...result, searchPlan, candidates };
}

export async function recordFindRunSummary(
  client: SupabaseClient,
  input: {
    jobId: string;
    actor: string;
    discovered: number;
    qualified: number;
    rejected: number;
    filteredReasons: Record<string, number>;
  },
) {
  const { data, error } = await client
    .from('sales_os_jobs')
    .update({
      status: 'completed',
      progress: {
        stage: 'completed',
        discovered: input.discovered,
        qualified: input.qualified,
        rejected: input.rejected,
      },
      result: { filteredReasons: input.filteredReasons },
      updated_by: input.actor,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('id', input.jobId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

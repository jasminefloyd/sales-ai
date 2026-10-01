import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { workerError } from '../_shared/directProviders.ts';
import {
  analyzeProductForWorker,
  analyzeLearningForWorker,
  executeEngagementForWorker,
  generateEngagementForWorker,
  generateAudiencesForWorker,
  suggestAudienceForWorker,
  runFindForWorker,
  enrichAudienceForWorker,
  recalculateAudienceQualityForWorker,
  scoreAudienceIntentForWorker,
  executeActivationSyncForWorker,
  executeAudienceRefreshForWorker,
  recomputeAttributionForWorker,
  type WorkerJobInput,
} from '../_shared/workerAnalysis.ts';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey)
  throw new Error('Missing Sales OS server Supabase configuration.');

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const workerId = `sales_os-worker:${crypto.randomUUID()}`;

type Job = {
  id: string;
  product_id: string;
  job_type: string;
  input: Record<string, unknown>;
  estimated_cost: number | null;
  attempt: number;
  max_attempts: number;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer '))
      throw new Error('Authentication required.');
    const { data: userData, error: userError } = await client.auth.getUser(
      authorization.slice(7),
    );
    if (userError || !userData.user) throw new Error('Authentication required.');

    const body = (await request.json().catch(() => ({}))) as { maxJobs?: number };
    const maxJobs = Math.min(Math.max(Number(body.maxJobs ?? 1), 1), 5);
    const results: Array<Record<string, unknown>> = [];

    for (let index = 0; index < maxJobs; index += 1) {
      const { data: claimed, error: claimError } = await client.rpc(
        'sales_os_claim_next_job',
        { p_worker_id: workerId },
      );
      if (claimError) throw claimError;
      const job = (Array.isArray(claimed) ? claimed[0] : claimed) as Job | null;
      if (!job) break;

      try {
        if (job.job_type === 'activation_sync') {
          const result = await executeActivationSyncForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          if (result.status !== 'executed' || !result.success) {
            await updateJobFailure(client, job, workerId, {
              code: result.error?.code ?? 'activation_sync_failed',
              message: result.error?.message ?? 'Activation sync failed.',
              retryable: result.error?.retryable ?? true,
            });
            results.push({
              jobId: job.id,
              status: 'failed',
              reason: 'activation_sync_failed',
            });
          } else {
            await completeJob(client, job, workerId, result);
            results.push({ ...result, jobId: job.id, status: 'completed' });
          }
          continue;
        }

        if (job.job_type === 'audience_refresh') {
          const result = await executeAudienceRefreshForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          if (result.status !== 'executed' || !result.success) {
            await updateJobFailure(client, job, workerId, {
              code: result.error?.code ?? 'audience_refresh_failed',
              message: result.error?.message ?? 'Audience refresh failed.',
              retryable: result.error?.retryable ?? true,
            });
            results.push({
              jobId: job.id,
              status: 'failed',
              reason: 'audience_refresh_failed',
            });
          } else {
            await completeJob(client, job, workerId, result);
            results.push({ ...result, jobId: job.id, status: 'completed' });
          }
          continue;
        }

        if (job.job_type === 'attribution') {
          const result = await recomputeAttributionForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          await completeJob(client, job, workerId, result);
          results.push({ ...result, jobId: job.id, status: 'completed' });
          continue;
        }

        if (job.job_type === 'engagement_batch' && job.input.mode === 'execute') {
          await executeEngagementForWorker(client, {job: job as WorkerJobInput, actor: workerId});
        }

        if (job.job_type === 'learning_analysis') {
          const result = await analyzeLearningForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          if (result.status === 'insufficient_sample') {
            await completeJob(client, job, workerId, result);
            results.push({ ...result, jobId: job.id, status: 'completed' });
          } else if (result.status !== 'executed' || !result.result.success) {
            await updateJobFailure(client, job, workerId, {
              code: result.result?.error?.code ?? 'learning_analysis_failed',
              message: result.result?.error?.message ?? 'Learning analysis failed.',
              retryable: result.result?.error?.retryable ?? false,
            });
            results.push({
              jobId: job.id,
              status: 'failed',
              reason: 'learning_analysis_failed',
            });
          } else {
            await completeJob(client, job, workerId, { learningId: ('learningId' in result ? result.learningId : undefined) });
            results.push({
              jobId: job.id,
              status: 'completed',
              learningId: ('learningId' in result ? result.learningId : undefined),
            });
          }
          continue;
        }

        if (job.job_type === 'engagement_batch') {
          const result = await generateEngagementForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          if (result.status !== 'executed' || !result.result.success) {
            await updateJobFailure(client, job, workerId, {
              code: result.result?.error?.code ?? 'engagement_draft_failed',
              message: result.result?.error?.message ?? 'Engagement draft failed.',
              retryable: result.result?.error?.retryable ?? false,
            });
            results.push({
              jobId: job.id,
              status: 'failed',
              reason: 'engagement_draft_failed',
              error: result.result?.error?.message ?? 'Engagement draft failed.',
            });
          } else {
            await completeJob(client, job, workerId, {
              engagementId: result.engagementId,
            });
            results.push({
              jobId: job.id,
              status: 'completed',
              engagementId: result.engagementId,
            });
          }
          continue;
        }

        if (job.job_type === 'audience_discovery') {
          if (job.input.mode === 'suggested_audience') {
            const result = await suggestAudienceForWorker(client, {
              productId: job.product_id,
              jobId: job.id,
              actor: workerId,
              estimatedCost: Number(job.estimated_cost ?? 0),
              suggestion: String(job.input.suggestion ?? ''),
            });
            if (result.status !== 'executed' || !result.result.success) {
              await updateJobFailure(client, job, workerId, {
                code: result.result?.error?.code ?? 'audience_suggestion_failed',
                message:
                  result.result?.error?.message ?? 'Suggested audience generation failed.',
                retryable: result.result?.error?.retryable ?? false,
              });
              results.push({
                jobId: job.id,
                status: 'failed',
                reason: 'audience_suggestion_failed',
              });
            } else {
              await completeJob(client, job, workerId, {
                audienceIds: ('persistedAudienceIds' in result ? result.persistedAudienceIds : undefined) ?? [],
              });
              results.push({
                jobId: job.id,
                status: 'completed',
                audienceIds: ('persistedAudienceIds' in result ? result.persistedAudienceIds : undefined) ?? [],
              });
            }
            continue;
          }
          const result = await generateAudiencesForWorker(client, {
            productId: job.product_id,
            jobId: job.id,
            actor: workerId,
            estimatedCost: Number(job.estimated_cost ?? 0),
            audienceId:
              typeof job.input.audienceId === 'string'
                ? job.input.audienceId
                : undefined,
          });
          if (result.status !== 'executed' || !result.result.success) {
            await updateJobFailure(client, job, workerId, {
              code: result.result?.error?.code ?? 'audience_generation_failed',
              message: result.result?.error?.message ?? 'Audience generation failed.',
              retryable: result.result?.error?.retryable ?? false,
            });
            results.push({
              jobId: job.id,
              status: 'failed',
              reason: 'audience_generation_failed',
            });
          } else {
            await completeJob(client, job, workerId, {
              audienceIds: ('persistedAudienceIds' in result ? result.persistedAudienceIds : undefined) ?? [],
            });
            results.push({
              jobId: job.id,
              status: 'completed',
              audienceIds: ('persistedAudienceIds' in result ? result.persistedAudienceIds : undefined) ?? [],
            });
          }
          continue;
        }

        if (job.job_type === 'find') {
          const result = await runFindForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          if (result.status !== 'executed' || !result.result.success) {
            await updateJobFailure(client, job, workerId, {
              code: result.result?.error?.code ?? 'find_failed',
              message: result.result?.error?.message ?? 'Find execution failed.',
              retryable: result.result?.error?.retryable ?? false,
            });
            results.push({ jobId: job.id, status: 'failed', reason: 'find_failed' });
          } else {
            await queueFollowUpEnrichment(client, job, workerId);
            await completeJob(client, job, workerId, {
              opportunityIds: ('savedOpportunityIds' in result ? result.savedOpportunityIds : undefined) ?? [],
              discoveryCounts: 'discoveryCounts' in result ? result.discoveryCounts : undefined,
            });
            results.push({
              jobId: job.id,
              status: 'completed',
              opportunityIds: ('savedOpportunityIds' in result ? result.savedOpportunityIds : undefined) ?? [],
            });
          }
          continue;
        }

        if (job.job_type === 'audience_enrichment') {
          const result = await enrichAudienceForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          if (result.status !== 'executed' || !result.result.success) {
            await updateJobFailure(client, job, workerId, {
              code: 'audience_enrichment_failed',
              message: 'Audience enrichment did not complete.',
              retryable: true,
            });
            results.push({
              jobId: job.id,
              status: 'failed',
              reason: 'audience_enrichment_failed',
            });
          } else {
            await queueFollowUpQuality(client, job, workerId);
            await completeJob(client, job, workerId, result.result);
            results.push({ jobId: job.id, status: 'completed', ...result.result });
          }
          continue;
        }

        if (job.job_type === 'audience_quality') {
          const result = await recalculateAudienceQualityForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          if (result.status !== 'executed' || !result.result.success) {
            await updateJobFailure(client, job, workerId, {
              code: 'audience_quality_failed',
              message: 'Audience quality calculation did not complete.',
              retryable: true,
            });
            results.push({
              jobId: job.id,
              status: 'failed',
              reason: 'audience_quality_failed',
            });
          } else {
            await queueFollowUpIntent(client, job, workerId);
            await completeJob(client, job, workerId, result.result);
            results.push({ jobId: job.id, status: 'completed', ...result.result });
          }
          continue;
        }

        if (job.job_type === 'audience_intent') {
          const result = await scoreAudienceIntentForWorker(client, {
            job: job as WorkerJobInput,
            actor: workerId,
          });
          if (result.status !== 'executed' || !result.result.success) {
            await updateJobFailure(client, job, workerId, {
              code: 'audience_intent_failed',
              message: 'Audience intent scoring did not complete.',
              retryable: true,
            });
            results.push({
              jobId: job.id,
              status: 'failed',
              reason: 'audience_intent_failed',
            });
          } else {
            await completeJob(client, job, workerId, result.result);
            results.push({ jobId: job.id, status: 'completed', ...result.result });
          }
          continue;
        }

        if (job.job_type !== 'product_analysis') {
          await updateJobFailure(client, job, workerId, {
            code: 'unsupported_job_type',
            message: `No worker executor exists for ${job.job_type}.`,
            retryable: false,
          });
          results.push({
            jobId: job.id,
            status: 'failed',
            reason: 'unsupported_job_type',
          });
          continue;
        }

        const { data: product, error: productError } = await client
          .from('sales_os_products')
          .select(
            'id,name,slug,status,website_url,description_input,primary_objective,geographic_constraints,additional_context,currency',
          )
          .eq('tenant_id', tenantId)
          .eq('id', job.product_id)
          .single();
        if (productError) throw productError;

        if (!['draft', 'analyzing'].includes(product.status)) {
          await completeJob(client, job, workerId, {
            skipped: true,
            reason: `Product is already ${product.status}.`,
          });
          results.push({ jobId: job.id, status: 'completed', skipped: true });
          continue;
        }

        const analysis = await analyzeProductForWorker(client, {
          productId: product.id,
          jobId: job.id,
          currentProductStatus: product.status,
          productContext: {
            name: product.name,
            slug: product.slug,
            websiteUrl: product.website_url,
            descriptionInput: product.description_input,
            primaryObjective: product.primary_objective,
            geographicConstraints: product.geographic_constraints,
            additionalContext: product.additional_context,
            currency: product.currency,
          },
          estimatedCost: Number(job.estimated_cost ?? 0),
          actor: workerId,
        });

        if (analysis.status === 'paused_budget') {
          results.push({ jobId: job.id, status: 'paused_budget' });
          continue;
        }
        if (analysis.status !== 'executed' || !analysis.result.success) {
          await updateJobFailure(client, job, workerId, {
            code: analysis.result?.error?.code ?? 'analysis_failed',
            message: analysis.result?.error?.message ?? 'Product analysis failed.',
            retryable: analysis.result?.error?.retryable ?? false,
          });
          results.push({ jobId: job.id, status: 'failed', reason: 'analysis_failed' });
          continue;
        }

        await completeJob(client, job, workerId, {
          productStatus: 'audience_review',
          workflowState: 'profile_review',
          provider: analysis.result.provider,
          cost: analysis.result.cost,
        });
        results.push({
          jobId: job.id,
          status: 'completed',
          productStatus: 'audience_review',
          workflowState: 'profile_review',
        });
      } catch (error) {
        await updateJobFailure(client, job, workerId, {
          ...workerError(error),
          retryable: job.attempt < job.max_attempts,
        });
        results.push({
          jobId: job.id,
          status: 'failed',
          reason: 'worker_exception',
          error: workerError(error).message,
        });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, jobs: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Worker failed.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

async function completeJob(
  db: SupabaseClient,
  job: Job,
  actor: string,
  result: Record<string, unknown>,
) {
  const { error } = await db
    .from('sales_os_jobs')
    .update({
      status: 'completed',
      result,
      actual_cost: Number(result.cost ?? 0),
      updated_by: actor,
      state_changed_by: actor,
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', job.id)
    .eq('status', 'running');
  if (error) throw error;
}

async function updateJobFailure(
  db: SupabaseClient,
  job: Job,
  actor: string,
  errorDetail: Record<string, unknown>,
) {
  const { error } = await db
    .from('sales_os_jobs')
    .update({
      status: 'failed',
      error: errorDetail,
      updated_by: actor,
      state_changed_by: actor,
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', job.id)
    .eq('status', 'running');
  if (error) throw error;
}

async function queueFollowUpEnrichment(db: SupabaseClient, job: Job, actor: string) {
  const audienceId =
    typeof job.input.audienceId === 'string' ? job.input.audienceId : '';
  if (!audienceId) return;
  const { data: definition, error: definitionError } = await db
    .from('sales_os_audience_definitions')
    .select('id,version')
    .eq('tenant_id', tenantId)
    .eq('audience_id', audienceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (definitionError || !definition) return;
  const { error } = await db.from('sales_os_jobs').upsert(
    {
      tenant_id: tenantId,
      product_id: job.product_id,
      job_type: 'audience_enrichment',
      status: 'queued',
      input: { audienceId, definitionId: definition.id, mode: 'post_find' },
      progress: { stage: 'queued', discovered: 0, enriched: 0, failed: 0 },
      result: {},
      estimated_cost: 0,
      max_attempts: 3,
      idempotency_key: `${tenantId}:${job.product_id}:audience_enrichment:${audienceId}:find:${job.id}`,
      created_by: actor,
      updated_by: actor,
      state_changed_by: actor,
    },
    { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
  );
  if (error) throw error;
}

async function queueFollowUpQuality(db: SupabaseClient, job: Job, actor: string) {
  const audienceId =
    typeof job.input.audienceId === 'string' ? job.input.audienceId : '';
  const definitionId =
    typeof job.input.definitionId === 'string' ? job.input.definitionId : '';
  if (!audienceId || !definitionId) return;
  const { error } = await db.from('sales_os_jobs').upsert(
    {
      tenant_id: tenantId,
      product_id: job.product_id,
      job_type: 'audience_quality',
      status: 'queued',
      input: { audienceId, definitionId, mode: 'post_enrichment' },
      progress: { stage: 'queued' },
      result: {},
      estimated_cost: 0,
      max_attempts: 3,
      idempotency_key: `${tenantId}:${job.product_id}:audience_quality:${audienceId}:enrichment:${job.id}`,
      created_by: actor,
      updated_by: actor,
      state_changed_by: actor,
    },
    { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
  );
  if (error) throw error;
}

async function queueFollowUpIntent(db: SupabaseClient, job: Job, actor: string) {
  const audienceId =
    typeof job.input.audienceId === 'string' ? job.input.audienceId : '';
  const definitionId =
    typeof job.input.definitionId === 'string' ? job.input.definitionId : '';
  if (!audienceId || !definitionId) return;
  const { error } = await db.from('sales_os_jobs').upsert(
    {
      tenant_id: tenantId,
      product_id: job.product_id,
      job_type: 'audience_intent',
      status: 'queued',
      input: { audienceId, definitionId, mode: 'post_quality' },
      progress: { stage: 'queued' },
      result: {},
      estimated_cost: 0,
      max_attempts: 3,
      idempotency_key: `${tenantId}:${job.product_id}:audience_intent:${audienceId}:quality:${job.id}`,
      created_by: actor,
      updated_by: actor,
      state_changed_by: actor,
    },
    { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
  );
  if (error) throw error;
}

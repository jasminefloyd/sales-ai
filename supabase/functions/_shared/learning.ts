import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const tenantId = 'sales_os';

export async function enqueueLearningAnalysis(
  client: SupabaseClient,
  productId: string,
  actor: string,
  minimumSampleSize = 10,
) {
  const month = new Date().toISOString().slice(0, 7);
  const { error } = await client.from('sales_os_jobs').upsert(
    {
      tenant_id: tenantId,
      product_id: productId,
      job_type: 'learning_analysis',
      status: 'queued',
      input: { minimumSampleSize, trigger: 'outcome_event' },
      progress: { stage: 'queued' },
      result: {},
      estimated_cost: 0,
      max_attempts: 3,
      idempotency_key: tenantId + ':' + productId + ':learning_analysis:' + month,
      created_by: actor,
      updated_by: actor,
      state_changed_by: actor,
    },
    { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
  );
  if (error) throw error;
}

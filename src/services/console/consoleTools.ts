import type { SupabaseClient } from '@supabase/supabase-js';

import { buildJobIdempotencyKey } from '../jobs/jobService';

const tenantId = 'sales_os';

export const readTools = [
  'get_product',
  'get_product_profile',
  'get_audiences',
  'search_opportunities',
  'get_opportunity',
  'get_engagements',
  'get_conversations',
  'get_performance',
  'get_learnings',
  'get_provider_performance',
  'get_job_status',
] as const;

export type ReadTool = (typeof readTools)[number];

export async function executeReadTool(
  client: SupabaseClient,
  tool: ReadTool,
  input: { productId: string; entityId?: string; status?: string; query?: string },
) {
  const scoped = (table: string) =>
    client
      .from(table)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('product_id', input.productId);
  switch (tool) {
    case 'get_product':
      return single(
        scoped('sales_os_products').eq('id', input.entityId ?? input.productId),
      );
    case 'get_product_profile':
      return single(
        scoped('sales_os_product_profiles')
          .eq('is_active', true)
          .order('version', { ascending: false })
          .limit(1),
      );
    case 'get_audiences':
      return many(
        scoped('sales_os_audiences').order('created_at', { ascending: false }),
      );
    case 'search_opportunities': {
      let query = scoped('sales_os_opportunities').order('discovered_at', {
        ascending: false,
      });
      if (input.status) query = query.eq('status', input.status);
      if (input.query)
        query = query.or(`title.ilike.%${input.query}%,summary.ilike.%${input.query}%`);
      return many(query);
    }
    case 'get_opportunity':
      return single(scoped('sales_os_opportunities').eq('id', input.entityId ?? ''));
    case 'get_engagements':
      return many(
        scoped('sales_os_engagements').order('created_at', { ascending: false }),
      );
    case 'get_conversations':
      return many(
        scoped('sales_os_conversations').order('last_activity_at', {
          ascending: false,
        }),
      );
    case 'get_performance':
      return many(scoped('sales_os_events').order('occurred_at', { ascending: false }));
    case 'get_learnings':
      return many(
        scoped('sales_os_learnings').order('created_at', { ascending: false }),
      );
    case 'get_provider_performance':
      return many(
        scoped('sales_os_provider_runs').order('created_at', { ascending: false }),
      );
    case 'get_job_status':
      return many(scoped('sales_os_jobs').order('created_at', { ascending: false }));
  }
}

export async function createConsoleAction(
  client: SupabaseClient,
  input: {
    tool:
      | 'request_find_run'
      | 'request_engagement_draft'
      | 'request_audience_change'
      | 'request_opportunity_rejection'
      | 'request_learning_application';
    productId: string;
    entityId?: string;
    payload: Record<string, unknown>;
    actor: string;
  },
) {
  if (input.tool === 'request_find_run') {
    const { data: job, error: jobError } = await client
      .from('sales_os_jobs')
      .insert({
        tenant_id: tenantId,
        product_id: input.productId,
        job_type: 'find',
        status: 'waiting_approval',
        input: input.payload,
        progress: { stage: 'awaiting_console_approval' },
        result: {},
        created_by: input.actor,
        updated_by: input.actor,
        state_changed_by: input.actor,
        idempotency_key: buildJobIdempotencyKey({
          productId: input.productId,
          jobType: 'find',
          scope: String(input.payload.audienceId ?? input.payload.routeId ?? 'product'),
        }),
      })
      .select()
      .single();
    if (jobError) throw jobError;
    return createApproval(client, input, job.id, 'request_find_run', job);
  }
  const entityType =
    input.tool === 'request_engagement_draft'
      ? 'opportunity'
      : input.tool === 'request_audience_change'
        ? 'audience'
        : input.tool === 'request_opportunity_rejection'
          ? 'opportunity'
          : 'learning';
  return createApproval(client, input, input.entityId ?? null, input.tool, {
    entityType,
    pending: true,
  });
}

async function createApproval(
  client: SupabaseClient,
  input: { productId: string; payload: Record<string, unknown>; actor: string },
  entityId: string | null,
  actionType: string,
  result: unknown,
) {
  const { data: approval, error } = await client
    .from('sales_os_approvals')
    .insert({
      tenant_id: tenantId,
      product_id: input.productId,
      entity_type: 'console_action',
      entity_id: entityId,
      action_type: actionType,
      proposed_payload: input.payload,
      status: 'pending',
      requested_by: input.actor,
      created_by: input.actor,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .select()
    .single();
  if (error) throw error;
  return { pendingApproval: true, approval, result };
}

// Supabase's fluent builders are table-generic; these helpers intentionally
// accept the narrowed query shape shared by the read-only tool boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function single(query: any) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function many(query: any) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

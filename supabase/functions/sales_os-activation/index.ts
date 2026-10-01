import { createClient } from 'npm:@supabase/supabase-js@2';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey)
  throw new Error('Missing Sales OS server configuration.');
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Body = {
  action?:
    'connect' | 'disconnect' | 'preview' | 'create' | 'approve' | 'sync' | 'retry';
  productId?: string;
  audienceId?: string;
  definitionId?: string;
  activationId?: string;
  destinationId?: string;
  destinationType?: 'csv' | 'webhook' | 'crm';
  connectorKey?: string;
  name?: string;
  endpointUrl?: string;
  secretRef?: string;
  publicConfig?: Record<string, unknown>;
  fieldMapping?: Record<string, unknown>;
  memberFilter?: Record<string, unknown>;
  syncMode?: 'full' | 'incremental' | 'retry';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer '))
      throw new Error('Authentication required.');
    const { data: auth, error: authError } = await client.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !auth.user) throw new Error('Authentication required.');
    const body = (await request.json()) as Body;
    if (!body.action) throw new Error('Activation action is required.');
    const actor = auth.user.id;

    if (body.action === 'connect') {
      if (!body.productId || !body.name || !body.destinationType)
        throw new Error(
          'Product, destination name, and destination type are required.',
        );
      if ('secret' in body || 'apiKey' in body)
        throw new Error(
          'Raw credentials must be stored as an Edge Function secret and referenced by secretRef.',
        );
      if (body.destinationType !== 'csv' && !body.endpointUrl)
        throw new Error('Webhook and CRM destinations require an endpoint URL.');
      const { data, error } = await client
        .from('sales_os_activation_destinations')
        .insert({
          tenant_id: tenantId,
          product_id: body.productId,
          destination_type: body.destinationType,
          connector_key: body.connectorKey ?? 'generic',
          name: body.name,
          endpoint_url: body.endpointUrl ?? null,
          secret_ref: body.secretRef ?? null,
          public_config: body.publicConfig ?? {},
          status: body.destinationType === 'csv' ? 'connected' : 'disconnected',
          created_by: actor,
          updated_by: actor,
        })
        .select(
          'id,product_id,destination_type,connector_key,name,endpoint_url,public_config,status,credential_version',
        )
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (body.action === 'disconnect') {
      if (!body.destinationId) throw new Error('destinationId is required.');
      const { data, error } = await client
        .from('sales_os_activation_destinations')
        .update({ status: 'disconnected', updated_by: actor })
        .eq('tenant_id', tenantId)
        .eq('id', body.destinationId)
        .select('id,status')
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (body.action === 'preview') {
      if (!body.audienceId) throw new Error('audienceId is required.');
      const definitionId =
        body.definitionId ||
        (await latestDefinitionId(body.audienceId, body.productId, actor));
      if (!definitionId) throw new Error('No audience definition is available.');
      return json({
        preview: await previewAudience(body.audienceId, definitionId, body.productId),
      });
    }

    if (body.action === 'create') {
      if (!body.productId || !body.audienceId || !body.destinationId)
        throw new Error('productId, audienceId, and destinationId are required.');
      const { data: audience, error: audienceError } = await client
        .from('sales_os_audiences')
        .select('id,product_id,icp_id,icp_version,audience_version,status')
        .eq('tenant_id', tenantId)
        .eq('product_id', body.productId)
        .eq('id', body.audienceId)
        .single();
      if (audienceError) throw audienceError;
      if (!['approved', 'active'].includes(audience.status))
        throw new Error('Only an approved audience can be activated.');
      const { data: destination, error: destinationError } = await client
        .from('sales_os_activation_destinations')
        .select('id,destination_type,status')
        .eq('tenant_id', tenantId)
        .eq('product_id', body.productId)
        .eq('id', body.destinationId)
        .single();
      if (destinationError) throw destinationError;
      if (destination.status !== 'connected')
        throw new Error('Destination must be connected before activation.');
      const definitionId =
        body.definitionId ??
        (await latestDefinitionId(body.audienceId, body.productId, actor));
      if (!definitionId) throw new Error('No audience definition is available.');
      const { data: activation, error } = await client
        .from('sales_os_audience_activations')
        .insert({
          tenant_id: tenantId,
          product_id: body.productId,
          destination_id: destination.id,
          icp_id: audience.icp_id,
          audience_id: audience.id,
          definition_id: definitionId,
          destination_type: destination.destination_type,
          destination_name: body.name ?? destination.id,
          destination_config: {},
          member_filter: body.memberFilter ?? { readiness: 'ready' },
          field_mapping: body.fieldMapping ?? {},
          sync_mode: body.syncMode ?? 'full',
          status: 'pending_approval',
          created_by: actor,
          updated_by: actor,
        })
        .select()
        .single();
      if (error) throw error;
      const { data: approval, error: approvalError } = await client
        .from('sales_os_approvals')
        .insert({
          tenant_id: tenantId,
          product_id: body.productId,
          entity_type: 'audience_activation',
          entity_id: activation.id,
          action_type: 'activate_audience',
          proposed_payload: {
            activationId: activation.id,
            audienceId: audience.id,
            destinationId: destination.id,
            definitionId,
          },
          status: 'pending',
          requested_by: actor,
          created_by: actor,
          updated_by: actor,
          state_changed_by: actor,
        })
        .select('id')
        .single();
      if (approvalError) throw approvalError;
      await client
        .from('sales_os_audience_activations')
        .update({ approval_id: approval.id, updated_by: actor })
        .eq('tenant_id', tenantId)
        .eq('id', activation.id);
      return json({ data: activation, approvalId: approval.id });
    }

    if (!body.activationId) throw new Error('activationId is required.');
    const { data: activation, error: activationError } = await client
      .from('sales_os_audience_activations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', body.activationId)
      .single();
    if (activationError) throw activationError;
    if (body.action === 'approve') {
      if (activation.status !== 'pending_approval')
        throw new Error('Only pending activations can be approved.');
      const { data: approval, error: approvalError } = await client
        .from('sales_os_approvals')
        .select('id,status')
        .eq('tenant_id', tenantId)
        .eq('id', activation.approval_id)
        .single();
      if (approvalError) throw approvalError;
      if (approval.status !== 'pending')
        throw new Error('Activation approval is no longer pending.');
      await client
        .from('sales_os_approvals')
        .update({
          status: 'approved',
          reviewed_by: actor,
          reviewed_at: new Date().toISOString(),
          updated_by: actor,
          state_changed_by: actor,
        })
        .eq('tenant_id', tenantId)
        .eq('id', approval.id)
        .eq('status', 'pending');
      const { data, error } = await client
        .from('sales_os_audience_activations')
        .update({
          status: 'approved',
          approved_by: actor,
          approved_at: new Date().toISOString(),
          updated_by: actor,
        })
        .eq('tenant_id', tenantId)
        .eq('id', activation.id)
        .eq('status', 'pending_approval')
        .select()
        .single();
      if (error) throw error;
      await queueSyncJob(data.id, data.product_id, data.sync_mode, actor);
      return json({ data, syncQueued: true });
    }
    if (!['sync', 'retry'].includes(body.action))
      throw new Error('Unsupported activation action.');
    if (!['approved', 'failed'].includes(activation.status))
      throw new Error('Activation must be approved or failed before syncing.');
    const mode = body.action === 'retry' ? 'retry' : activation.sync_mode;
    await queueSyncJob(activation.id, activation.product_id, mode, actor);
    return json({ syncQueued: true, activationId: activation.id, mode });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Activation operation failed.',
      },
      400,
    );
  }
});

async function latestDefinitionId(
  audienceId: string,
  productId: string | undefined,
  actor: string,
) {
  const audienceQuery = client
    .from('sales_os_audiences')
    .select(
      'id,product_id,icp_id,audience_version,name,buyer_type,problem_use_case_fit,status',
    )
    .eq('tenant_id', tenantId)
    .eq('id', audienceId);
  if (productId) audienceQuery.eq('product_id', productId);
  const { data: audience, error: audienceError } = await audienceQuery.single();
  if (audienceError) throw audienceError;
  if (!['approved', 'active'].includes(audience.status)) {
    throw new Error('Only an approved audience can be activated.');
  }

  const { data, error } = await client
    .from('sales_os_audience_definitions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('audience_id', audienceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data?.id) return data.id;

  const { data: created, error: createError } = await client
    .from('sales_os_audience_definitions')
    .insert({
      tenant_id: tenantId,
      product_id: audience.product_id,
      icp_id: audience.icp_id,
      audience_id: audience.id,
      version: Number(audience.audience_version ?? 1),
      definition_kind: 'snapshot',
      name: audience.name,
      description: audience.problem_use_case_fit,
      rule_definition: {
        buyerType: audience.buyer_type,
        audienceVersion: audience.audience_version,
      },
      source_system: 'sales_os',
      source_record_id: audience.id,
      confidence: 0.8,
      provenance: [{ source: 'approved_audience', audienceId: audience.id }],
      consent_state: 'unknown',
      status: 'active',
      created_by: actor,
      updated_by: actor,
    })
    .select('id')
    .single();
  if (createError) throw createError;
  return created.id;
}

async function previewAudience(
  audienceId: string,
  definitionId: string,
  productId?: string,
) {
  const query = client
    .from('sales_os_audience_members')
    .select(
      'id,account_id,contact_id,external_entity_key,status,suppression_state,consent_state',
    )
    .eq('tenant_id', tenantId)
    .eq('audience_id', audienceId)
    .eq('definition_id', definitionId);
  if (productId) query.eq('product_id', productId);
  const { data, error } = await query;
  if (error) throw error;
  const memberIds = (data ?? []).map((member) => member.id);
  const { data: quality, error: qualityError } = memberIds.length
    ? await client
        .from('sales_os_audience_quality_snapshots')
        .select('member_id,readiness_state')
        .eq('tenant_id', tenantId)
        .in('member_id', memberIds)
        .eq('is_current', true)
    : { data: [], error: null };
  if (qualityError) throw qualityError;
  const qualityByMember = new Map(
    (quality ?? []).map((row) => [row.member_id, row.readiness_state]),
  );
  const records = (data ?? []).map((member) => ({
    ...member,
    quality_state: qualityByMember.get(member.id) ?? null,
  }));
  const eligible = records.filter(
    (member) =>
      member.status === 'ready' &&
      member.quality_state === 'ready' &&
      member.suppression_state === 'clear' &&
      !['restricted', 'revoked'].includes(member.consent_state),
  );
  return {
    total: records.length,
    eligibleCount: eligible.length,
    blockedCount: records.length - eligible.length,
    eligible,
    blocked: records.filter(
      (member) => !eligible.some((item) => item.id === member.id),
    ),
  };
}

async function queueSyncJob(
  activationId: string,
  productId: string,
  mode: string,
  actor: string,
) {
  const { error } = await client.from('sales_os_jobs').upsert(
    {
      tenant_id: tenantId,
      product_id: productId,
      job_type: 'activation_sync',
      status: 'queued',
      input: { activationId, mode },
      progress: { stage: 'queued' },
      result: {},
      estimated_cost: 0,
      max_attempts: 3,
      idempotency_key: `${tenantId}:${productId}:activation:${activationId}:${mode}`,
      created_by: actor,
      updated_by: actor,
      state_changed_by: actor,
    },
    { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
  );
  if (error) throw error;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

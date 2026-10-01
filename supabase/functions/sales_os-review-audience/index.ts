import { createClient } from 'npm:@supabase/supabase-js@2';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Sales OS server Supabase configuration.');
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const audienceTransitions: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  activate: 'active',
  pause: 'paused',
};

const routeTransitions: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  activate: 'active',
  pause: 'paused',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let operation = 'request validation';
  let operationId: string | null = null;
  let reviewPersisted = false;
  try {
    operation = 'authentication';
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authorization.slice('Bearer '.length);
    const { data: userData, error: userError } = await client.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Authentication required.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as {
      entityType?: 'icp' | 'audience' | 'route';
      entityId?: string;
      action?: string;
      updates?: Record<string, unknown>;
      rediscover?: boolean;
      runRequestId?: string;
    };
    if (!body.entityType || !body.entityId || !body.action) {
      return new Response(
        JSON.stringify({ error: 'entityType, entityId, and action are required.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
    if (!['icp', 'audience', 'route'].includes(body.entityType))
      throw new Error('Unsupported review target.');
    if (body.runRequestId !== undefined &&
      (typeof body.runRequestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.runRequestId)))
      throw new Error('runRequestId must contain 1–128 letters, numbers, underscores, or hyphens.');
    operationId = `${tenantId}:${body.entityType}:${body.entityId}:${body.action}`;
    if (body.action === 'edit') {
      operation = `${body.entityType} edit lookup`;
      if (!body.updates) throw new Error('Edits require updates.');
      if (body.entityType === 'icp') {
        const allowed = [
          'name',
          'summary',
          'core_problem',
          'why_product_fits',
          'purchase_trigger',
          'current_alternative',
          'buying_motivation',
          'purchase_friction',
          'decision_maker',
          'budget_fit',
          'purchase_readiness',
          'validation_rationale',
          'commercial_evidence',
          'priority',
        ];
        const updates = Object.fromEntries(
          Object.entries(body.updates).filter(([key]) => allowed.includes(key)),
        );
        if (typeof updates.name !== 'string' || !updates.name.trim())
          throw new Error('ICP name is required.');
        const { data: current, error: currentError } = await client
          .from('sales_os_icps')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('id', body.entityId)
          .single();
        if (currentError) throw currentError;
        const {
          id: _id,
          created_at: _createdAt,
          updated_at: _updatedAt,
          state_changed_at: _stateChangedAt,
          version: currentVersion,
          ...immutableFields
        } = current;
        const { data, error } = await client
          .from('sales_os_icps')
          .insert({
            ...immutableFields,
            ...updates,
            version: Number(currentVersion) + 1,
            status: 'proposed',
            is_primary: current.is_primary,
            created_by: userData.user.id,
            updated_by: userData.user.id,
            state_changed_by: userData.user.id,
          })
          .select()
          .single();
        if (error) throw error;
        return new Response(JSON.stringify({ data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (body.entityType !== 'audience') throw new Error('Unsupported edit target.');
      const allowed = [
        'name',
        'problem_use_case_fit',
        'purchase_triggers',
        'relevant_terminology',
        'priority',
        'outreach_motion',
      ];
      const updates = Object.fromEntries(
        Object.entries(body.updates).filter(([key]) => allowed.includes(key)),
      );
      if (typeof updates.outreach_motion === 'string') {
        const motion = updates.outreach_motion;
        updates.collateral_strategy =
          motion === 'b2b'
            ? {
                primaryType: 'personalized_email',
                channels: ['email', 'professional_social'],
                cta: 'Request a conversation or product walkthrough.',
              }
            : motion === 'b2b2c'
              ? {
                  primaryType: 'segmented_email_and_community',
                  channels: ['email', 'community', 'professional_social'],
                  cta: 'Choose the CTA appropriate to the buyer role.',
                }
              : motion === 'community'
                ? {
                    primaryType: 'public_conversation_response',
                    channels: ['reddit', 'community', 'professional_social'],
                    cta: 'Offer a useful response and transparent next step.',
                  }
                : {
                    primaryType: 'signup_focused_social_content',
                    channels: ['reddit', 'community', 'professional_social'],
                    cta: 'Invite a low-friction signup or trial.',
                  };
      }
      if (typeof updates.name !== 'string' || !updates.name.trim()) {
        throw new Error('Audience name is required.');
      }
      const { data: current, error: currentError } = await client
        .from('sales_os_audiences')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', body.entityId)
        .single();
      if (currentError) throw currentError;
      const {
        id: _audienceId,
        created_at: _audienceCreatedAt,
        updated_at: _audienceUpdatedAt,
        state_changed_at: _audienceStateChangedAt,
        audience_version: currentAudienceVersion,
        ...audienceImmutableFields
      } = current;
      const displayLabels = {
        ...((audienceImmutableFields.display_labels ?? {}) as Record<string, unknown>),
      };
      if (updates.name !== undefined) delete displayLabels.name;
      if (updates.problem_use_case_fit !== undefined) delete displayLabels.problem;
      if (updates.purchase_triggers !== undefined)
        delete displayLabels.purchaseTriggers;
      const { data, error } = await client
        .from('sales_os_audiences')
        .insert({
          ...audienceImmutableFields,
          ...updates,
          display_labels: displayLabels,
          audience_version: Number(currentAudienceVersion) + 1,
          status: 'proposed',
          created_by: userData.user.id,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        })
        .select()
        .single();
      if (error) throw error;
      if (body.rediscover) {
        const { error: rediscoveryJobError } = await client
          .from('sales_os_jobs')
          .upsert(
            {
              tenant_id: tenantId,
              product_id: data.product_id,
              job_type: 'audience_discovery',
              status: 'queued',
              input: {
                productId: data.product_id,
                audienceId: data.id,
                mode: 'rediscover_audience',
              },
              progress: { stage: 'queued' },
              result: {},
              estimated_cost: 0,
              max_attempts: 3,
              idempotency_key: `${tenantId}:${data.product_id}:audience_rediscovery:${data.id}:v${data.audience_version}`,
              created_by: userData.user.id,
              updated_by: userData.user.id,
              state_changed_by: userData.user.id,
            },
            {
              onConflict: 'tenant_id,product_id,idempotency_key',
              ignoreDuplicates: true,
            },
          );
        if (rediscoveryJobError) throw rediscoveryJobError;
      }
      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const icpTransitions: Record<string, string> = {
      approve: 'approved',
      reject: 'rejected',
      activate: 'active',
      pause: 'paused',
    };
    if (body.entityType === 'icp' && body.action === 'approve') {
      operation = 'ICP approval quality gate';
      const { data: icp, error: icpError } = await client
        .from('sales_os_icps')
        .select(
          'id, product_id, status, name, summary, core_problem, why_product_fits, purchase_trigger, ai_fit_assessment, evidence, budget_fit, purchase_readiness, commercial_evidence',
        )
        .eq('tenant_id', tenantId)
        .eq('id', body.entityId)
        .single();
      if (icpError) throw icpError;
      const missing = [
        icp.name,
        icp.summary,
        icp.core_problem,
        icp.why_product_fits,
        icp.purchase_trigger,
        icp.ai_fit_assessment,
      ].some((value) => !String(value ?? '').trim());
      if (
        missing ||
        !Array.isArray(icp.evidence) ||
        icp.evidence.length === 0
      )
        throw new Error(
          'ICP quality gate failed: complete the core ICP fields and attach supporting evidence before approval.',
        );
    }
    if (body.entityType === 'audience' && body.action === 'approve') {
      operation = 'audience approval quality gate';
      const { data: child, error: childError } = await client
        .from('sales_os_audiences')
        .select(
          'id, icp_id, icp_version, audience_version, product_id, buyer_type, outreach_motion, collateral_strategy, supporting_evidence, problem_use_case_fit, ai_fit_assessment',
        )
        .eq('tenant_id', tenantId)
        .eq('id', body.entityId)
        .single();
      if (childError) throw childError;
      if (!child.icp_id)
        throw new Error('Audience quality gate failed: no parent ICP is attached.');
      const { data: parent, error: parentError } = await client
        .from('sales_os_icps')
        .select('status')
        .eq('tenant_id', tenantId)
        .eq('product_id', child.product_id)
        .eq('version', child.icp_version)
        .eq('id', child.icp_id)
        .single();
      if (parentError) throw parentError;
      if (!['proposed', 'approved', 'active'].includes(parent.status))
        throw new Error('The parent ICP is not available for audience generation.');
      if (
        !child.problem_use_case_fit?.trim() ||
        !child.ai_fit_assessment?.trim() ||
        !Array.isArray(child.supporting_evidence) ||
        child.supporting_evidence.length === 0
      )
        throw new Error(
          'Audience quality gate failed: complete the audience and attach reachability evidence.',
        );
    }
    const nextStatus = (
      body.entityType === 'icp'
        ? icpTransitions
        : body.entityType === 'audience'
          ? audienceTransitions
          : routeTransitions
    )[body.action];
    if (!nextStatus) {
      return new Response(JSON.stringify({ error: 'Unsupported review action.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const table =
      body.entityType === 'icp'
        ? 'sales_os_icps'
        : body.entityType === 'audience'
          ? 'sales_os_audiences'
          : 'sales_os_audience_routes';
    operation = 'review state lookup';
    const { data: current, error: lookupError } = await client.from(table)
      .select('*').eq('tenant_id', tenantId).eq('id', body.entityId).single();
    if (lookupError) throw lookupError;
    // Activation is not an alternative approval path.
    if (body.action === 'activate' && !['approved', 'active', 'paused'].includes(current.status))
      throw new Error('Approve this record before activation.');
    if (body.entityType === 'route' && ['approve', 'activate'].includes(body.action)) {
      const { data: audience, error: audienceError } = await client.from('sales_os_audiences')
        .select('status').eq('tenant_id', tenantId).eq('product_id', current.product_id)
        .eq('id', current.audience_id).single();
      if (audienceError) throw audienceError;
      if (!['approved', 'active'].includes(audience.status))
        throw new Error('Approve the parent audience before discovering contacts.');
    }
    const preserveStatus = body.action === 'approve' && ['approved', 'active', 'paused'].includes(current.status);
    operation = 'review state persistence';
    const { data, error } = preserveStatus ? { data: current, error: null } : await client
      .from(table)
      .update({
        status: nextStatus,
        updated_by: userData.user.id,
        state_changed_by: userData.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', body.entityId)
      .eq('product_id', current.product_id)
      .eq('status', current.status)
      .select()
      .single();
    if (error) throw error;
    reviewPersisted = true;

    if (
      (nextStatus === 'approved' || nextStatus === 'active') &&
      body.entityType !== 'icp' &&
      !(body.entityType === 'audience' && body.action === 'approve')
    ) {
      const { count, error: countError } = await client
        .from(
          body.entityType === 'audience'
              ? 'sales_os_audiences'
              : 'sales_os_audience_routes',
        )
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('product_id', data.product_id)
        .in('status', ['approved', 'active']);
      if (countError) throw countError;
      if ((count ?? 0) > 0) {
        const { error: productError } = await client
          .from('sales_os_products')
          .update({
            status: 'active',
            updated_by: userData.user.id,
            state_changed_by: userData.user.id,
          })
          .eq('tenant_id', tenantId)
          .eq('id', data.product_id)
          .eq('status', 'audience_review');
        if (productError) throw productError;
      }
    }

    if (body.entityType === 'route' && ['approve', 'activate'].includes(body.action)) {
      operation = 'route find job queueing';
      const runRequestId = body.action === 'activate' && data.route_type === 'direct'
        ? body.runRequestId ?? crypto.randomUUID() : null;
      if (runRequestId) operationId = `${operationId}:${runRequestId}`;
      const { error: jobError } = await client.from('sales_os_jobs').upsert(
        {
          tenant_id: tenantId,
          product_id: data.product_id,
          job_type: 'find',
          status: 'queued',
          input: { audienceId: data.audience_id, routeId: data.id, runRequestId },
          progress: { stage: 'queued', discovered: 0, qualified: 0, rejected: 0 },
          result: {},
          estimated_cost: 0,
          max_attempts: 3,
          idempotency_key: `${tenantId}:${data.product_id}:find:${data.id}${runRequestId ? `:run:${runRequestId}` : ''}`,
          created_by: userData.user.id,
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        },
        { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
      );
      if (jobError) throw jobError;
    }

    if (body.entityType === 'audience' && body.action === 'approve') {
      operation = 'audience definition and downstream queue creation';
      let enrichmentJobQueued = false;
      let qualityJobQueued = false;
      {
        operation = 'audience definition lookup';
        const { data: existingDefinition, error: definitionLookupError } = await client
          .from('sales_os_audience_definitions')
          .select('id,icp_id,version')
          .eq('tenant_id', tenantId)
          .eq('product_id', data.product_id)
          .eq('audience_id', data.id)
          .eq('version', Number(data.audience_version ?? 1))
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (definitionLookupError) throw definitionLookupError;
        let definition = existingDefinition;
        if (!definition) {
          operation = 'audience definition creation';
          const { data: createdDefinition, error: definitionError } = await client
            .from('sales_os_audience_definitions')
            .upsert({
              tenant_id: tenantId,
              product_id: data.product_id,
              icp_id: data.icp_id,
              audience_id: data.id,
              version: Number(data.audience_version ?? 1),
              definition_kind: 'snapshot',
              name: data.name,
              description: data.problem_use_case_fit,
              rule_definition: {
                buyerType: data.buyer_type,
                audienceVersion: data.audience_version,
              },
              source_system: 'sales_os',
              source_record_id: data.id,
              confidence: 0.8,
              provenance: [{ source: 'approved_audience', audienceId: data.id }],
              consent_state: 'unknown',
              status: 'active',
              created_by: userData.user.id,
              updated_by: userData.user.id,
            }, { onConflict: 'tenant_id,product_id,audience_id,version', ignoreDuplicates: true })
            .select('id,icp_id,version')
            .maybeSingle();
          if (definitionError) throw definitionError;
          definition = createdDefinition;
          if (!definition) {
            const { data: concurrentDefinition, error: concurrentError } = await client
              .from('sales_os_audience_definitions').select('id,icp_id,version')
              .eq('tenant_id', tenantId).eq('product_id', data.product_id)
              .eq('audience_id', data.id).eq('version', Number(data.audience_version ?? 1)).single();
            if (concurrentError) throw concurrentError;
            definition = concurrentDefinition;
          }
        }
        if (data.buyer_type === 'organization') {
          operation = 'B2B enrichment job queueing';
          const { error: enrichmentJobError } = await client
            .from('sales_os_jobs')
            .upsert(
              {
                tenant_id: tenantId,
                product_id: data.product_id,
                job_type: 'audience_enrichment',
                status: 'queued',
                input: {
                  audienceId: data.id,
                  definitionId: definition.id,
                  mode: 'approved_b2b_audience',
                },
                progress: { stage: 'queued', discovered: 0, enriched: 0, failed: 0 },
                result: {},
                estimated_cost: 0,
                max_attempts: 3,
                idempotency_key: `${tenantId}:${data.product_id}:audience_enrichment:${data.id}:v${definition.version}`,
                created_by: userData.user.id,
                updated_by: userData.user.id,
                state_changed_by: userData.user.id,
              },
              {
                onConflict: 'tenant_id,product_id,idempotency_key',
                ignoreDuplicates: true,
              },
            );
          if (enrichmentJobError) throw enrichmentJobError;
          enrichmentJobQueued = true;
        }
        operation = 'audience quality job queueing';
        const { error: qualityJobError } = await client.from('sales_os_jobs').upsert(
          {
            tenant_id: tenantId,
            product_id: data.product_id,
            job_type: 'audience_quality',
            status: 'queued',
            input: {
              audienceId: data.id,
              definitionId: definition.id,
              mode: 'approved_audience',
            },
            progress: { stage: 'queued' },
            result: {},
            estimated_cost: 0,
            max_attempts: 3,
            idempotency_key: `${tenantId}:${data.product_id}:audience_quality:${data.id}:v${definition.version}`,
            created_by: userData.user.id,
            updated_by: userData.user.id,
            state_changed_by: userData.user.id,
          },
          {
            onConflict: 'tenant_id,product_id,idempotency_key',
            ignoreDuplicates: true,
          },
        );
        if (qualityJobError) throw qualityJobError;
        qualityJobQueued = true;
      }
      operation = 'audience route activation';
      const { error: routeError } = await client
        .from('sales_os_audience_routes')
        .update({
          status: 'active',
          updated_by: userData.user.id,
          state_changed_by: userData.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('product_id', data.product_id)
        .eq('audience_id', data.id)
        .in('status', data.status === 'paused' ? [] : ['proposed'])
        .eq('status', 'proposed')
        .select('id,route_type,rationale,collateral_type,status');
      if (routeError) throw routeError;
      const { data: existingRoutes, error: existingRoutesError } = await client
        .from('sales_os_audience_routes').select('id,route_type,rationale,collateral_type,status')
        .eq('tenant_id', tenantId).eq('product_id', data.product_id).eq('audience_id', data.id);
      if (existingRoutesError) throw existingRoutesError;
      let proposedRoutes = (existingRoutes ?? []).filter((route) =>
        data.status !== 'paused' && ['approved', 'active'].includes(route.status));

      // B2B approval always includes a direct discovery route, even when the
      // model returned only a social/community route.
      const isB2B =
        data.buyer_type === 'organization' ||
        ['b2b', 'b2b2c'].includes(String(data.outreach_motion ?? '').toLowerCase());
      if (
        isB2B &&
        data.status !== 'paused' &&
        !(existingRoutes ?? []).some((route) => route.route_type === 'direct')
      ) {
        operation = 'B2B direct route creation';
        const { data: directRoute, error: directRouteError } = await client
          .from('sales_os_audience_routes')
          .upsert(
            {
              tenant_id: tenantId,
              product_id: data.product_id,
              audience_id: data.id,
              route_type: 'direct',
              status: 'active',
              rationale:
                'Suggested for direct contact discovery from the business sales motion.',
              search_strategy: {
                generatedBy: 'approval_enforced_direct_v1',
                motion: String(data.outreach_motion ?? 'b2b'),
              },
              collateral_type: 'personalized_email',
              auto_discover: true,
              created_by: userData.user.id,
              updated_by: userData.user.id,
              state_changed_by: userData.user.id,
            },
            { onConflict: 'tenant_id,audience_id,route_type', ignoreDuplicates: true },
          )
          .select('id,route_type,rationale,collateral_type,status')
          .maybeSingle();
        if (directRouteError) throw directRouteError;
        if (directRoute) proposedRoutes.push(directRoute);
      }

      if (!(existingRoutes?.length ?? 0) && !proposedRoutes.length && data.status !== 'paused') {
        operation = 'fallback route creation';
        const motion = String(data.outreach_motion ?? '').toLowerCase();
        const routeTypes =
          motion === 'b2b'
            ? ['direct']
            : motion === 'b2b2c'
              ? ['direct', 'social']
              : data.buyer_type === 'organization'
                ? ['direct']
                : ['social'];
        const { data: fallbackRoutes, error: fallbackError } = await client
          .from('sales_os_audience_routes')
          .upsert(
            routeTypes.map((routeType) => ({
              tenant_id: tenantId,
              product_id: data.product_id,
              audience_id: data.id,
              route_type: routeType,
              status: 'active',
              rationale:
                'Fallback route derived from the approved ' +
                (motion || data.buyer_type) +
                ' ICP.',
              search_strategy: {
                generatedBy: 'approval_fallback_v1',
                motion: motion || data.buyer_type,
              },
              collateral_type:
                routeType === 'direct'
                  ? 'personalized_email'
                  : 'public_conversation_response',
              auto_discover: true,
              created_by: userData.user.id,
              updated_by: userData.user.id,
              state_changed_by: userData.user.id,
            })),
            { onConflict: 'tenant_id,audience_id,route_type', ignoreDuplicates: true },
          )
          .select('id,route_type,rationale,collateral_type,status');
        if (fallbackError) throw fallbackError;
        proposedRoutes?.push(...(fallbackRoutes ?? []));
      }

      // Re-read after insert races, and include routes activated before an interrupted request.
      const { data: recoveredRoutes, error: recoveryError } = await client
        .from('sales_os_audience_routes').select('id,route_type,rationale,collateral_type,status')
        .eq('tenant_id', tenantId).eq('product_id', data.product_id).eq('audience_id', data.id)
        .in('status', ['approved', 'active']);
      if (recoveryError) throw recoveryError;
      proposedRoutes = data.status === 'paused' ? [] : recoveredRoutes ?? [];

      const { data: approvedProfile, error: profileError } = await client
        .from('sales_os_product_profiles')
        .select('id, version')
        .eq('tenant_id', tenantId)
        .eq('product_id', data.product_id)
        .eq('is_active', true)
        .eq('review_status', 'approved')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (profileError) throw profileError;

      const motion = String(data.outreach_motion ?? '').toLowerCase();
      for (const route of proposedRoutes ?? []) {
        operation = 'outreach decision creation';
        const channel =
          route.route_type === 'direct'
            ? 'email'
            : motion === 'b2b'
              ? 'professional_social'
              : motion === 'community'
                ? 'community'
                : 'reddit';
        const { error: decisionError } = await client
          .from('sales_os_outreach_decisions')
          .upsert(
            {
              tenant_id: tenantId,
              product_id: data.product_id,
              product_profile_id: approvedProfile?.id ?? null,
              icp_id: data.icp_id,
              icp_version: data.icp_version,
              audience_id: data.id,
              audience_version: data.audience_version,
              channel,
              outreach_motion: ['b2b', 'b2c', 'b2b2c', 'community'].includes(motion)
                ? motion
                : data.buyer_type === 'organization'
                  ? 'b2b'
                  : 'b2c',
              objective: data.problem_use_case_fit,
              rationale: route.rationale,
              collateral_type:
                route.collateral_type ?? 'audience-specific outreach copy',
              cta: data.collateral_strategy?.cta ?? null,
              strategy: {
                determinedFrom: 'approved_icp_audience',
                routeType: route.route_type,
                audienceId: data.id,
              },
              status: 'proposed',
              version: 1,
              created_by: userData.user.id,
              updated_by: userData.user.id,
              state_changed_by: userData.user.id,
            },
            { onConflict: 'tenant_id,audience_id,channel,version', ignoreDuplicates: true },
          );
        if (decisionError) throw decisionError;
      }

      let findQueued = 0;
      for (const route of proposedRoutes ?? []) {
        if (!route.id) continue;
        operation = 'find job queueing';
        const { error: findJobError } = await client.from('sales_os_jobs').upsert(
          {
            tenant_id: tenantId,
            product_id: data.product_id,
            job_type: 'find',
            status: 'queued',
            input: { audienceId: data.id, routeId: route.id },
            progress: { stage: 'queued', discovered: 0, qualified: 0, rejected: 0 },
            result: {},
            estimated_cost: 0,
            max_attempts: 3,
            idempotency_key: `${tenantId}:${data.product_id}:find:${route.id}`,
            created_by: userData.user.id,
            updated_by: userData.user.id,
            state_changed_by: userData.user.id,
          },
          {
            onConflict: 'tenant_id,product_id,idempotency_key',
            ignoreDuplicates: true,
          },
        );
        if (findJobError) throw findJobError;
        findQueued += 1;
      }

      if ((proposedRoutes?.length ?? 0) > 0) {
        operation = 'product activation';
        const { error: productError } = await client
          .from('sales_os_products')
          .update({
            status: 'active',
            updated_by: userData.user.id,
            state_changed_by: userData.user.id,
          })
          .eq('tenant_id', tenantId)
          .eq('id', data.product_id)
          .eq('status', 'audience_review');
        if (productError) throw productError;
      }

      return new Response(
        JSON.stringify({
          data,
          operationId,
          recoveryComplete: true,
          routesEnsured: proposedRoutes?.length ?? 0,
          outreachDecisionsEnsured: proposedRoutes?.length ?? 0,
          findJobsEnsured: findQueued,
          enrichmentJobEnsured: enrichmentJobQueued,
          qualityJobEnsured: qualityJobQueued,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ data, operationId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const databaseError =
      error && typeof error === 'object'
        ? (error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown })
        : null;
    return new Response(
      JSON.stringify({
        error: typeof databaseError?.message === 'string' ? databaseError.message : 'Review action failed.',
        operation,
        operationId,
        reviewPersisted,
        code: typeof databaseError?.code === 'string' ? databaseError.code : null,
        details:
          typeof databaseError?.details === 'string' ? databaseError.details : null,
        hint: typeof databaseError?.hint === 'string' ? databaseError.hint : null,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

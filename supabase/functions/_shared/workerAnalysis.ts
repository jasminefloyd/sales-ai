import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { calculateAttribution } from './attribution.ts';
import { directSearchQuery, normalizeCompanyResults, executeHunter, discoveryRecordId, ContactProviderError, isFreshVerifiedEmail } from './directProviders.ts';
import {
  decisionDisplayLabels,
  normalizeAudienceLabels,
  normalizeIcpLabels,
  normalizeProfileLabels,
} from './displayLabels.ts';
import { completeIcpCandidate } from './icpCompletion.ts';
import { assertRecipientSafeDraft, buildCopyGrounding } from './copyGrounding.ts';
import { rankContactCandidates } from './contactSelection.ts';

type ProviderRow = {
  id: string;
  provider_key: string;
  capability: string;
  enabled: boolean;
  priority: number;
};

type WorkerInput = {
  productId: string;
  jobId: string;
  currentProductStatus: 'draft' | 'analyzing';
  productContext: Record<string, unknown>;
  estimatedCost: number;
  actor: string;
};

export type WorkerJobInput = {
  id: string;
  product_id: string;
  job_type: string;
  input: Record<string, unknown>;
  estimated_cost: number | null;
  attempt: number;
  max_attempts: number;
};

type CapabilityResult = {
  provider: string;
  success: boolean;
  data: unknown;
  cost: number;
  latencyMs: number;
  externalIds?: Record<string,string>;
  error?: { code: string; message: string; retryable: boolean };
};

const tenantId = 'sales_os';

function copyTypeForChannel(channel: string) {
  if (channel === 'email') return 'email';
  if (channel === 'reddit' || channel === 'community') return 'community_post';
  if (channel === 'professional_social' || channel === 'social') return 'social_post';
  return 'outreach_message';
}

export async function analyzeProductForWorker(
  client: SupabaseClient,
  input: WorkerInput,
) {
  if (input.currentProductStatus === 'draft') {
    await transitionProduct(client, input.productId, 'draft', 'analyzing', input.actor);
  }

  let sourceEvidence: unknown[] = [];
  const productUrl =
    typeof input.productContext.websiteUrl === 'string'
      ? input.productContext.websiteUrl
      : undefined;
  if (productUrl) {
    const scrape = await executeWithBudget(
      client,
      'scrapePage',
      { url: productUrl },
      input,
      `product-scrape:${input.productId}`,
      true,
    );
    if (scrape.status === 'paused_budget') return scrape;
    if (scrape.result.success)
      sourceEvidence = normalizeEvidence(scrape.result.data, productUrl, 'website');
    if (!sourceEvidence.length) {
      const search = await executeWithBudget(
        client,
        'searchWeb',
        { query: productUrl },
        input,
        `product-search:${input.productId}`,
        true,
      );
      if (search.status === 'paused_budget') return search;
      if (search.result.success)
        sourceEvidence = normalizeEvidence(search.result.data, productUrl, 'search');
    }
  }

  const reasoning = await executeWithBudget(
    client,
    'reasoning',
    {
      task: 'product_sales_profile',
      product: input.productContext,
      sourceEvidence,
      outputRequirements: {
        format: 'JSON only',
        fields: [
          'product',
          'category',
          'description',
          'problemsSolved',
          'coreCapabilities',
          'primaryUseCases',
          'pricingBusinessModel',
          'conversionEvent',
          'purchaseFriction',
          'competitiveAlternatives',
          'purchaseTriggers',
          'positioningValueProps',
          'sourceEvidence',
          'outreachMotion',
          'outreachMotionReason',
          'collateralStrategy',
          'displayLabels',
        ],
        displayLabelRules:
          'displayLabels contains optional short UI labels and never replaces full fields. Use concise sentence-case labels; item labels must include the exact canonical source string.',
      },
    },
    input,
    `product-reasoning:${input.productId}`,
  );
  if (reasoning.status !== 'executed' || !reasoning.result.success) return reasoning;

  const profile = validateProfile(reasoning.result.data);
  const { data: current, error: currentError } = await client
    .from('sales_os_product_profiles')
    .select('version')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (currentError) throw currentError;
  const { data: persisted, error: profileError } = await client
    .from('sales_os_product_profiles')
    .insert({
      tenant_id: tenantId,
      product_id: input.productId,
      version: Number(current?.version ?? 0) + 1,
      category: profile.category,
      description: profile.description,
      problems_solved: profile.problemsSolved,
      core_capabilities: profile.coreCapabilities,
      primary_use_cases: profile.primaryUseCases,
      pricing_business_model: profile.pricingBusinessModel,
      conversion_event: profile.conversionEvent,
      purchase_friction: profile.purchaseFriction,
      competitive_alternatives: profile.competitiveAlternatives,
      purchase_triggers: profile.purchaseTriggers,
      positioning_value_props: profile.positioningValueProps,
      source_evidence: profile.sourceEvidence,
      outreach_motion: profile.outreachMotion,
      outreach_motion_reason: profile.outreachMotionReason,
      collateral_strategy: profile.collateralStrategy,
      display_labels: normalizeProfileLabels(
        (reasoning.result.data as Record<string, unknown>)?.displayLabels,
        profile,
      ),
      is_active: false,
      review_status: 'needs_review',
      created_by: 'ai',
    })
    .select()
    .single();
  if (profileError) throw profileError;
  const { data: sourceRows, error: sourceError } = await client
    .from('sales_os_product_sources')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId);
  if (sourceError) throw sourceError;
  for (const source of sourceRows ?? []) {
    await recordWorkflowLineage(client, {
      productId: input.productId,
      relationType: 'source_to_profile',
      sourceId: source.id,
      profileId: persisted.id,
      actor: input.actor,
    });
  }
  const provenanceFields = [
    ['category', profile.category],
    ['description', profile.description],
    ['problemsSolved', profile.problemsSolved],
    ['coreCapabilities', profile.coreCapabilities],
    ['primaryUseCases', profile.primaryUseCases],
    ['pricingBusinessModel', profile.pricingBusinessModel],
    ['conversionEvent', profile.conversionEvent],
    ['purchaseFriction', profile.purchaseFriction],
    ['competitiveAlternatives', profile.competitiveAlternatives],
    ['purchaseTriggers', profile.purchaseTriggers],
    ['positioningValueProps', profile.positioningValueProps],
  ] as const;
  for (const [fieldName, value] of provenanceFields) {
    const sourceEvidence = Array.isArray(profile.sourceEvidence)
      ? profile.sourceEvidence
      : [];
    const { error: provenanceError } = await client
      .from('sales_os_product_profile_provenance')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: input.productId,
          profile_id: persisted.id,
          field_name: fieldName,
          value,
          source: (sourceEvidence[0] as {url?:string} | undefined)?.url ?? null,
          source_type: sourceEvidence.length ? 'research' : 'inferred',
          confidence: sourceEvidence.length ? 'medium' : 'low',
          evidence_status: sourceEvidence.length ? 'researched' : 'inferred',
        },
        { onConflict: 'tenant_id,profile_id,field_name' },
      );
    if (provenanceError) throw provenanceError;
  }
  await transitionProduct(
    client,
    input.productId,
    'analyzing',
    'audience_review',
    input.actor,
  );
  return { status: 'executed' as const, result: reasoning.result, profile, persisted };
}

export async function executeWithBudget(
  client: SupabaseClient,
  capability: string,
  payload: Record<string, unknown>,
  input: Pick<WorkerInput, 'productId' | 'jobId' | 'estimatedCost' | 'actor'> & Partial<Pick<WorkerInput, 'currentProductStatus' | 'productContext'>>,
  requestReference: string,
  allProviders = false,
) {
  const budget = await client.rpc('sales_os_check_budget', {
    p_product_id: input.productId,
    p_estimated_cost: input.estimatedCost,
    p_job_id: input.jobId,
    p_requested_by: input.actor,
  });
  if (budget.error) throw budget.error;
  const decision = Array.isArray(budget.data) ? budget.data[0] : budget.data;
  if (!decision?.allowed)
    return {
      status: 'paused_budget' as const,
      result: null,
    };

  const providers = await loadProviders(client, capability);
  if (!providers.length) {
    await releaseReservation(client, decision.reservation_id, input.actor);
    return {
      status: 'failed' as const,
      result: {
        provider: 'none',
        success: false,
        data: null,
        cost: 0,
        latencyMs: 0,
        error: {
          code: 'no_provider',
          message: `No enabled provider for ${capability}.`,
          retryable: false,
        },
      } satisfies CapabilityResult,
    };
  }

  let lastResult: CapabilityResult | null = null;
  const successfulResults: CapabilityResult[] = [];
  for (const provider of providers) {
    const startedAt = Date.now();
    const run = await client
      .from('sales_os_provider_runs')
      .insert({
        tenant_id: tenantId,
        product_id: input.productId,
        provider_id: provider.id,
        capability,
        job_id: input.jobId,
        request_reference: requestReference,
        status: 'started',
        estimated_cost: input.estimatedCost,
        prompt_version: 'sales_os_prompt_v1',
        model_identifier: modelFor(provider.provider_key),
        created_by: input.actor,
        updated_by: input.actor,
      })
      .select('id')
      .single();
    if (run.error) throw run.error;
    try {
      const result = await callProvider(provider.provider_key, capability, payload);
      result.latencyMs = Date.now() - startedAt;
      if (result.success) {
        await finishRun(client, run.data.id, result, 'succeeded');
        if (allProviders) {
          successfulResults.push(result);
          lastResult = result;
          continue;
        }
        await finalizeReservation(
          client,
          decision.reservation_id,
          'consumed',
          input.actor,
        );
        return { status: 'executed' as const, result };
      }
      lastResult = result;
      await finishRun(client, run.data.id, result, 'failed');
      if (!allProviders && (capability !== 'reasoning' || !result.error?.retryable))
        break;
    } catch (error) {
      const result: CapabilityResult = {
        provider: provider.provider_key,
        success: false,
        data: null,
        cost: 0,
        latencyMs: Date.now() - startedAt,
        error: {
          code: 'provider_exception',
          message: error instanceof Error ? error.message : 'Provider request failed.',
          retryable: true,
        },
      };
      lastResult = result;
      await finishRun(client, run.data.id, result, 'failed');
      if (!allProviders && capability !== 'reasoning') break;
    }
  }
  if (allProviders && successfulResults.length > 0) {
    await finalizeReservation(client, decision.reservation_id, 'consumed', input.actor);
    return {
      status: 'executed' as const,
      result: {
        provider: successfulResults.map((item) => item.provider).join(','),
        success: true,
        data: successfulResults.flatMap((item) =>
          Array.isArray(item.data) ? item.data : [item.data],
        ),
        cost: successfulResults.reduce((sum, item) => sum + item.cost, 0),
        latencyMs: Math.max(...successfulResults.map((item) => item.latencyMs)),
      } satisfies CapabilityResult,
    };
  }
  await finalizeReservation(client, decision.reservation_id, 'released', input.actor);
  if (!lastResult) throw new Error('Provider execution ended without a result.');
  return { status: 'failed' as const, result: lastResult };
}

export async function generateAudiencesForWorker(
  client: SupabaseClient,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    audienceId?: string;
  },
) {
  if (input.audienceId) {
    return rediscoverAudienceForWorker(client, {...input, audienceId: input.audienceId});
  }
  const { data: profile, error: profileError } = await client
    .from('sales_os_product_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('is_active', true)
    .eq('review_status', 'approved')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile)
    throw new Error('Cannot generate audiences without an active product profile.');
  const { data: approvedLearnings, error: learningError } = await client
    .from('sales_os_learnings')
    .select('observation,recommended_change,target_phase')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('status', 'active');
  if (learningError) throw learningError;

  const audienceResearch = await executeWithBudget(
    client,
    'searchWeb',
    {
      query: buildAudienceEvidenceQuery(profile),
      numResults: 8,
      approvedLearnings: approvedLearnings ?? [],
    },
    {
      productId: input.productId,
      jobId: input.jobId,
      actor: input.actor,
      estimatedCost: input.estimatedCost,
    },
    `audience-research:${input.productId}`,
    true,
  );
  if (audienceResearch.status === 'paused_budget') return audienceResearch;
  const validatingEvidence =
    audienceResearch.status === 'executed' && audienceResearch.result.success
      ? normalizeResearchEvidence(audienceResearch.result.data)
      : [];

  const result = await executeWithBudget(
    client,
    'reasoning',
    {
      task: 'generate_audience_hypotheses',
      canonicalProductProfile: profile,
      validatingEvidence,
      approvedLearnings: approvedLearnings ?? [],
      outputRequirements: {
        recommendedValidationFields: [
          'budgetFit',
          'purchaseReadiness',
          'commercialEvidence',
          'validationRationale',
          'commercialIntentScore',
        ],
        displayLabelRules:
          'Include optional displayLabels with short user-facing labels. Never replace canonical fields. Audience names describe people, not the product; labels must be concise and sentence case.',
        completionRules:
          'Complete every ICP field from the canonical product profile and research context. Never return empty strings, nulls, or placeholder values such as Unknown, Unavailable, or Pending human review. When source evidence is insufficient, provide a clearly labeled AI inference and set completion.requiresHumanReview=true. Do not present an inference as source evidence.',
      },
      constraints: {
        doNotApprove: true,
        doNotInventEvidence: true,
        format: 'JSON only',
        audienceCount:
          'Return up to 6 distinct ICP hypotheses: 1 strongest primary candidate followed by no more than 5 secondary candidates. Return multiple candidates when the product supports materially different buyer groups.',
      },
    },
    {
      productId: input.productId,
      jobId: input.jobId,
      actor: input.actor,
      estimatedCost: input.estimatedCost,
    },
    `audience-discovery:${input.productId}`,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  const payload = result.result.data as { audiences?: Array<Record<string, unknown>> };
  const aiAudiences: Array<Record<string,unknown>> =
    Array.isArray(payload?.audiences) && payload.audiences.length > 0
      ? payload.audiences
      : [buildDeterministicAudience(profile)];
  const completedAudiences = aiAudiences.map((audience) =>
    completeIcpCandidate(audience, profile, validatingEvidence),
  );
  const persisted = [];
  let icpVersion = 1;
  const { data: currentIcp } = await client
    .from('sales_os_icps')
    .select('version')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count: primaryIcpCount, error: primaryIcpError } = await client
    .from('sales_os_icps')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('is_primary', true)
    .neq('status', 'rejected');
  if (primaryIcpError) throw primaryIcpError;
  const hasPrimaryIcp = (primaryIcpCount ?? 0) > 0;
  const { count: activeIcpCount, error: activeIcpError } = await client
    .from('sales_os_icps')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .neq('status', 'rejected');
  if (activeIcpError) throw activeIcpError;
  const remainingIcpSlots = Math.max(0, 6 - (activeIcpCount ?? 0));
  const boundedAudiences = completedAudiences.slice(0, remainingIcpSlots);
  icpVersion = Number(currentIcp?.version ?? 0) + 1;
  for (const [audienceIndex, audience] of boundedAudiences.entries()) {
    const strategy = deriveAudienceStrategy(audience);
    const evidence = Array.isArray(audience.supportingEvidence)
      ? audience.supportingEvidence
      : [];
    const problemFit = String(audience.problemUseCaseFit ?? '').trim();
    const fitAssessment = String(audience.aiFitAssessment ?? '').trim();
    const purchaseTriggers = Array.isArray(audience.purchaseTriggers)
      ? audience.purchaseTriggers
      : [];
    const audienceLabels = normalizeAudienceLabels(audience.displayLabels, {
      purchaseTriggers,
    });
    const icpLabels = normalizeIcpLabels({
      ...(audience.displayLabels && typeof audience.displayLabels === 'object'
        ? audience.displayLabels
        : {}),
      summary: problemFit,
    });
    const terminology = Array.isArray(audience.relevantTerminology)
      ? audience.relevantTerminology
      : [];
    const buyingBehavior =
      audience.buyingBehavior && typeof audience.buyingBehavior === 'object'
        ? (audience.buyingBehavior as Record<string, unknown>)
        : {};
    const budgetFit = String(
      audience.budgetFit ?? buyingBehavior.budgetFit ?? 'Pending human review',
    ).trim() || 'Pending human review';
    const purchaseReadiness = String(
      audience.purchaseReadiness ?? buyingBehavior.purchaseReadiness ?? 'Pending human review',
    ).trim() || 'Pending human review';
    const commercialEvidence = Array.isArray(audience.commercialEvidence)
      ? audience.commercialEvidence
      : [];
    const { data: icp, error: icpError } = await client
      .from('sales_os_icps')
      .insert({
        tenant_id: tenantId,
        product_id: input.productId,
        version: icpVersion++,
        name: String(audience.name ?? 'Unnamed ICP'),
        display_labels: icpLabels,
        buyer_type:
          audience.buyerType === 'organization' ? 'organization' : 'individual',
        summary: problemFit,
        core_problem: problemFit,
        why_product_fits: fitAssessment,
        purchase_trigger: String(audience.purchaseTrigger ?? purchaseTriggers[0] ?? problemFit),
        current_alternative: String(
          audience.currentAlternative ?? buyingBehavior.currentAlternative ?? 'Existing manual workflows',
        ),
        buying_motivation: String(audience.buyingMotivation ?? problemFit),
        purchase_friction: String(
          audience.purchaseFriction ?? buyingBehavior.purchaseFriction ?? 'Confirming expected value and changing the current workflow',
        ),
        decision_maker:
          audience.buyerType === 'organization'
            ? String(audience.decisionMaker ?? buyingBehavior.buyer ?? 'The budget owner or department leader')
            : null,
        company_characteristics:
          audience.buyerType === 'organization'
            ? (audience.companyCharacteristics ?? buyingBehavior)
            : {},
        user_characteristics:
          audience.buyerType === 'individual'
            ? (audience.userCharacteristics ?? buyingBehavior)
            : {},
        relevant_language: terminology,
        acquisition_routes: audience.routes ?? [],
        evidence,
        evidence_score:
          evidence.length >= 3 ? 'high' : evidence.length >= 1 ? 'medium' : 'low',
        evidence_score_detail: { evidenceCount: evidence.length },
        ai_fit_assessment: fitAssessment,
        priority: ['low', 'high'].includes(String(audience.priority))
          ? audience.priority
          : 'medium',
        status: 'proposed',
        is_primary: !hasPrimaryIcp && audienceIndex === 0,
        quality_gate: {
          requiredFieldsPresent: Boolean(
            problemFit && fitAssessment && purchaseTriggers.length &&
              String(audience.currentAlternative ?? '').trim() &&
              String(audience.buyingMotivation ?? problemFit).trim() &&
              String(audience.purchaseFriction ?? '').trim(),
          ),
          requiresHumanReview: true,
          completion: audience.completion ?? null,
        },
        budget_fit: budgetFit,
        purchase_readiness: purchaseReadiness,
        commercial_evidence: commercialEvidence,
        validation_status: 'pending_review',
        validation_rationale: String(audience.validationRationale ?? ''),
        created_by: input.actor,
        updated_by: input.actor,
        state_changed_by: input.actor,
      })
      .select('id,version')
      .single();
    if (icpError) throw icpError;
    const { data: savedAudience, error: audienceError } = await client
      .from('sales_os_audiences')
      .insert({
        tenant_id: tenantId,
        product_id: input.productId,
        icp_id: icp.id,
        icp_version: icp.version,
        audience_version: 1,
        audience_summary: problemFit || 'Reachable segment requires human review.',
        name: String(audience.name ?? 'Unnamed audience'),
        display_labels: audienceLabels,
        buyer_type:
          audience.buyerType === 'organization' ? 'organization' : 'individual',
        outreach_motion: strategy.motion,
        outreach_motion_reason: strategy.reason,
        collateral_strategy: strategy.collateral,
        problem_use_case_fit: problemFit,
        buying_behavior: buyingBehavior,
        purchase_triggers: purchaseTriggers,
        relevant_terminology: terminology,
        supporting_evidence: evidence,
        reachability_evidence: evidence,
        evidence_score:
          evidence.length >= 3 ? 'high' : evidence.length >= 1 ? 'medium' : 'low',
        evidence_score_detail: { evidenceCount: evidence.length },
        ai_fit_assessment: fitAssessment,
        priority: ['low', 'high'].includes(String(audience.priority))
          ? audience.priority
          : 'medium',
        status: 'proposed',
        quality_gate: {
          requiredFieldsPresent: Boolean(problemFit && fitAssessment && purchaseTriggers.length),
          requiresHumanReview: true,
          parentIcpId: icp.id,
          completion: audience.completion ?? null,
        },
        validation_status: 'pending_review',
        validation_evidence: commercialEvidence,
        commercial_intent_score:
          typeof audience.commercialIntentScore === 'number'
            ? Math.min(1, Math.max(0, audience.commercialIntentScore))
            : null,
        created_by: input.actor,
        updated_by: input.actor,
        state_changed_by: input.actor,
      })
      .select()
      .single();
    if (audienceError) throw audienceError;
    await recordWorkflowLineage(client, {
      productId: input.productId,
      relationType: 'profile_to_icp',
      profileId: profile.id,
      icpId: icp.id,
      actor: input.actor,
    });
    await recordWorkflowLineage(client, {
      productId: input.productId,
      relationType: 'icp_to_audience',
      icpId: icp.id,
      audienceId: savedAudience.id,
      actor: input.actor,
    });
    const routes = ensureRoutes(audience.routes, strategy);
    for (const route of routes) {
      if (!['social', 'direct'].includes(String(route.routeType))) continue;
      const { error: routeError } = await client
        .from('sales_os_audience_routes')
        .insert({
          tenant_id: tenantId,
          product_id: input.productId,
          audience_id: savedAudience.id,
          route_type: route.routeType,
          status: 'proposed',
          rationale: String(route.rationale ?? ''),
          search_strategy: route.searchStrategy ?? {},
          collateral_type: String(
            route.collateralType ?? strategy.collateral.primaryType,
          ),
          auto_discover: true,
          created_by: input.actor,
          updated_by: input.actor,
          state_changed_by: input.actor,
        });
      if (routeError) throw routeError;
    }
    for (const route of routes) {
      if (!['social', 'direct'].includes(String(route.routeType))) continue;
      const motion = strategy.motion;
      const channel =
        route.routeType === 'direct'
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
            product_id: input.productId,
            product_profile_id: profile.id,
            icp_id: icp.id,
            icp_version: icp.version,
            audience_id: savedAudience.id,
            audience_version: 1,
            channel,
            outreach_motion: motion,
            objective:
              problemFit ||
              'Advance a qualified audience toward the product conversion goal.',
            rationale: String(route.rationale ?? strategy.reason),
            display_labels: decisionDisplayLabels({
              channel,
              motion,
              conversionEvent: (profile.conversion_event ?? {}) as Record<
                string,
                unknown
              >,
              isFallback:
                (route.searchStrategy as Record<string,unknown> | undefined)?.generatedBy === 'icp_strategy_fallback_v1',
            }),
            collateral_type: String(
              route.collateralType ?? strategy.collateral.primaryType,
            ),
            cta: strategy.collateral.cta ?? null,
            strategy: {
              determinedFrom: 'approved_product_profile_and_generated_audience',
              routeType: route.routeType,
              audienceId: savedAudience.id,
            },
            status: 'proposed',
            version: 1,
            created_by: input.actor,
            updated_by: input.actor,
            state_changed_by: input.actor,
          },
          { onConflict: 'tenant_id,audience_id,channel,version' },
        );
      if (decisionError) throw decisionError;
      const { data: decision } = await client
        .from('sales_os_outreach_decisions')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('product_id', input.productId)
        .eq('audience_id', savedAudience.id)
        .eq('channel', channel)
        .eq('version', 1)
        .single();
      if (decision) {
        await recordWorkflowLineage(client, {
          productId: input.productId,
          relationType: 'audience_to_outreach_decision',
          audienceId: savedAudience.id,
          outreachDecisionId: decision.id,
          actor: input.actor,
        });
      }
    }
    persisted.push(savedAudience.id);
  }
  return {
    ...result,
    persistedAudienceIds: persisted,
    fallbackUsed: aiAudiences.length === 1 && !Array.isArray(payload?.audiences),
    providerShape: describeShape(result.result.data),
  };
}

export async function suggestAudienceForWorker(
  client: SupabaseClient,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    suggestion: string;
  },
) {
  if (!input.suggestion.trim()) throw new Error('An audience suggestion is required.');

  const [{ data: profile, error: profileError }, { data: existingIcps, error: icpError }] =
    await Promise.all([
      client
        .from('sales_os_product_profiles')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('product_id', input.productId)
        .eq('is_active', true)
        .eq('review_status', 'approved')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from('sales_os_icps')
        .select('id,name,summary,buyer_type,status,is_primary')
        .eq('tenant_id', tenantId)
        .eq('product_id', input.productId)
        .neq('status', 'rejected'),
    ]);
  if (profileError) throw profileError;
  if (icpError) throw icpError;
  if (!profile)
    throw new Error('Approve the Product Sales Profile before suggesting an audience.');
  if ((existingIcps ?? []).length >= 6)
    throw new Error('This product already has the maximum of six ICPs.');

  const research = await executeWithBudget(
    client,
    'searchWeb',
    {
      query: `${buildAudienceEvidenceQuery(profile)} ${input.suggestion}`,
      numResults: 8,
    },
    {
      productId: input.productId,
      jobId: input.jobId,
      actor: input.actor,
      estimatedCost: input.estimatedCost,
    },
    `audience-suggestion-research:${input.productId}:${input.suggestion.slice(0, 80)}`,
    true,
  );
  if (research.status === 'paused_budget') return research;
  const validatingEvidence =
    research.status === 'executed' && research.result.success
      ? normalizeResearchEvidence(research.result.data)
      : [];

  const reasoning = await executeWithBudget(
    client,
    'reasoning',
    {
      task: 'evaluate_suggested_audience',
      canonicalProductProfile: profile,
      existingIcps: existingIcps ?? [],
      userSuggestion: input.suggestion.trim(),
      validatingEvidence,
      outputRequirements: {
        format: 'JSON only',
        exactlyOneAudience: true,
        fields: [
          'name',
          'buyerType',
          'problemUseCaseFit',
          'buyingBehavior',
          'purchaseTriggers',
          'relevantTerminology',
          'supportingEvidence',
          'aiFitAssessment',
          'priority',
          'routes',
        ],
        roleRequirements:
          'For organization audiences, buyingBehavior must identify buyer, influencer, end-user, and organization roles separately.',
      },
      constraints: {
        doNotApprove: true,
        doNotInventEvidence: true,
        format: 'JSON only',
        returnOneCandidate: true,
      },
    },
    {
      productId: input.productId,
      jobId: input.jobId,
      actor: input.actor,
      estimatedCost: input.estimatedCost,
    },
    `audience-suggestion:${input.productId}:${input.jobId}`,
  );
  if (reasoning.status !== 'executed' || !reasoning.result.success) return reasoning;

  const raw = reasoning.result.data as Record<string, unknown>;
  const rawCandidate = Array.isArray(raw)
    ? (raw[0] as Record<string, unknown> | undefined)
    : Array.isArray(raw.audiences)
      ? (raw.audiences[0] as Record<string, unknown> | undefined)
      : raw;
  if (!rawCandidate || typeof rawCandidate !== 'object')
    throw new Error('AI returned no suggested audience.');
  const candidate = completeIcpCandidate(rawCandidate, profile, validatingEvidence);

  const strategy = deriveAudienceStrategy(candidate);
  const evidence = Array.isArray(candidate.supportingEvidence)
    ? candidate.supportingEvidence
    : validatingEvidence;
  const problemFit = String(candidate.problemUseCaseFit ?? '').trim();
  const fitAssessment = String(candidate.aiFitAssessment ?? '').trim();
  const purchaseTriggers = Array.isArray(candidate.purchaseTriggers)
    ? candidate.purchaseTriggers.map(String).filter(Boolean)
    : [];
  const terminology = Array.isArray(candidate.relevantTerminology)
    ? candidate.relevantTerminology.map(String).filter(Boolean)
    : [];
  const buyingBehavior =
    candidate.buyingBehavior && typeof candidate.buyingBehavior === 'object'
      ? (candidate.buyingBehavior as Record<string, unknown>)
      : {};
  const name = String(candidate.name ?? '').trim();
  if (!name || !problemFit || !fitAssessment)
    throw new Error('The suggested audience did not contain the required review fields.');
  const currentVersion = Math.max(
    0,
    ...(existingIcps ?? []).map((icp) => Number((icp as { version?: number }).version ?? 0)),
  );
  const { data: latestIcp, error: latestIcpError } = await client
    .from('sales_os_icps')
    .select('version')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestIcpError) throw latestIcpError;
  const buyerType = candidate.buyerType === 'organization' ? 'organization' : 'individual';
  const isPrimary = !(existingIcps ?? []).some(
    (icp) => Boolean((icp as { is_primary?: boolean }).is_primary),
  );
  const version = Math.max(currentVersion, Number(latestIcp?.version ?? 0)) + 1;
  const evidenceScore = evidence.length >= 3 ? 'high' : evidence.length ? 'medium' : 'low';
  const { data: icp, error: newIcpError } = await client
    .from('sales_os_icps')
    .insert({
      tenant_id: tenantId,
      product_id: input.productId,
      version,
      name,
      buyer_type: buyerType,
      summary: problemFit,
      core_problem: problemFit,
      why_product_fits: fitAssessment,
      purchase_trigger: String(candidate.purchaseTrigger ?? purchaseTriggers[0] ?? problemFit),
      current_alternative: String(candidate.currentAlternative ?? buyingBehavior.currentAlternative ?? 'Existing manual workflows'),
      buying_motivation: String(candidate.buyingMotivation ?? problemFit),
      purchase_friction: String(candidate.purchaseFriction ?? buyingBehavior.purchaseFriction ?? 'Confirming expected value and changing the current workflow'),
      decision_maker: buyerType === 'organization'
        ? String(candidate.decisionMaker ?? buyingBehavior.buyer ?? 'The budget owner or department leader')
        : null,
      company_characteristics: buyerType === 'organization' ? buyingBehavior : {},
      user_characteristics: buyerType === 'individual' ? buyingBehavior : {},
      relevant_language: terminology,
      acquisition_routes: candidate.routes ?? [],
      evidence,
      evidence_score: evidenceScore,
      evidence_score_detail: { evidenceCount: evidence.length, userSuggested: true },
      ai_fit_assessment: fitAssessment,
      priority: ['low', 'high'].includes(String(candidate.priority))
        ? candidate.priority
        : 'medium',
      status: 'proposed',
      is_primary: isPrimary,
      quality_gate: {
        requiresHumanReview: true,
        userSuggested: true,
        completion: candidate.completion ?? null,
      },
      budget_fit: String(candidate.budgetFit ?? buyingBehavior.budgetFit ?? 'AI inference requires review').trim(),
      purchase_readiness: String(candidate.purchaseReadiness ?? buyingBehavior.purchaseReadiness ?? 'AI inference requires review').trim(),
      commercial_evidence: Array.isArray(candidate.commercialEvidence)
        ? candidate.commercialEvidence
        : [{
            type: 'ai_inference',
            statement: 'Commercial fit was inferred from the product profile and requires human confirmation.',
            confidence: 'low',
          }],
      validation_status: 'pending_review',
      validation_rationale: String(candidate.validationRationale ?? `Suggested by the user: ${input.suggestion.trim()}`),
      created_by: input.actor,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .select('id,version')
    .single();
  if (newIcpError) throw newIcpError;

  const audienceLabels = normalizeAudienceLabels(candidate.displayLabels, {
    purchaseTriggers,
  });
  const { data: audience, error: audienceError } = await client
    .from('sales_os_audiences')
    .insert({
      tenant_id: tenantId,
      product_id: input.productId,
      icp_id: icp.id,
      icp_version: icp.version,
      audience_version: 1,
      audience_summary: problemFit,
      name,
      display_labels: audienceLabels,
      buyer_type: buyerType,
      outreach_motion: strategy.motion,
      outreach_motion_reason: 'Suggested by you and evaluated against the approved Product Sales Profile.',
      collateral_strategy: strategy.collateral,
      problem_use_case_fit: problemFit,
      buying_behavior: { ...buyingBehavior, userSuggested: true },
      purchase_triggers: purchaseTriggers,
      relevant_terminology: terminology,
      supporting_evidence: evidence,
      reachability_evidence: evidence,
      evidence_score: evidenceScore,
      evidence_score_detail: { evidenceCount: evidence.length, userSuggested: true },
      ai_fit_assessment: fitAssessment,
      priority: ['low', 'high'].includes(String(candidate.priority))
        ? candidate.priority
        : 'medium',
      status: 'proposed',
      quality_gate: {
        requiresHumanReview: true,
        userSuggested: true,
        parentIcpId: icp.id,
        completion: candidate.completion ?? null,
      },
      validation_status: 'pending_review',
      validation_evidence: Array.isArray(candidate.commercialEvidence)
        ? candidate.commercialEvidence
        : [],
      created_by: input.actor,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .select('id')
    .single();
  if (audienceError) throw audienceError;

  const routes = ensureRoutes(candidate.routes, strategy);
  for (const route of routes) {
    const { data: savedRoute, error: routeError } = await client
      .from('sales_os_audience_routes')
      .insert({
        tenant_id: tenantId,
        product_id: input.productId,
        audience_id: audience.id,
        route_type: route.routeType,
        status: 'proposed',
        rationale: String(route.rationale ?? ''),
        search_strategy: route.searchStrategy ?? { generatedBy: 'user_suggested_audience_v1' },
        collateral_type: String(route.collateralType ?? strategy.collateral.primaryType),
        auto_discover: true,
        created_by: input.actor,
        updated_by: input.actor,
        state_changed_by: input.actor,
      })
      .select('id,route_type,rationale')
      .single();
    if (routeError) throw routeError;
    const channel = route.routeType === 'direct' ? 'email' : strategy.motion === 'b2b' ? 'professional_social' : 'community';
    const { data: decision, error: decisionError } = await client
      .from('sales_os_outreach_decisions')
      .insert({
        tenant_id: tenantId,
        product_id: input.productId,
        product_profile_id: profile.id,
        icp_id: icp.id,
        icp_version: icp.version,
        audience_id: audience.id,
        audience_version: 1,
        channel,
        outreach_motion: strategy.motion,
        objective: problemFit,
        rationale: String(route.rationale ?? strategy.reason),
        collateral_type: String(route.collateralType ?? strategy.collateral.primaryType),
        cta: strategy.collateral.cta,
        strategy: { determinedFrom: 'user_suggested_audience', routeType: route.routeType },
        status: 'proposed',
        version: 1,
        created_by: input.actor,
        updated_by: input.actor,
        state_changed_by: input.actor,
      })
      .select('id')
      .single();
    if (decisionError) throw decisionError;
    await recordWorkflowLineage(client, {
      productId: input.productId,
      relationType: 'audience_to_outreach_decision',
      audienceId: audience.id,
      outreachDecisionId: decision.id,
      actor: input.actor,
    });
    void savedRoute;
  }
  await recordWorkflowLineage(client, {
    productId: input.productId,
    relationType: 'profile_to_icp',
    profileId: profile.id,
    icpId: icp.id,
    actor: input.actor,
  });
  await recordWorkflowLineage(client, {
    productId: input.productId,
    relationType: 'icp_to_audience',
    icpId: icp.id,
    audienceId: audience.id,
    actor: input.actor,
  });
  return {
    ...reasoning,
    persistedAudienceIds: [audience.id],
    suggestedIcpId: icp.id,
  };
}

async function rediscoverAudienceForWorker(
  client: SupabaseClient,
  input: {
    productId: string;
    jobId: string;
    actor: string;
    estimatedCost: number;
    audienceId: string;
  },
) {
  const [
    { data: profile, error: profileError },
    { data: audience, error: audienceError },
  ] = await Promise.all([
    client
      .from('sales_os_product_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('product_id', input.productId)
      .eq('is_active', true)
      .eq('review_status', 'approved')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('sales_os_audiences')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('product_id', input.productId)
      .eq('id', input.audienceId)
      .single(),
  ]);
  if (profileError) throw profileError;
  if (audienceError) throw audienceError;
  if (!profile)
    throw new Error('Cannot rediscover an audience without an active product profile.');

  const { data: approvedLearnings, error: learningError } = await client
    .from('sales_os_learnings')
    .select('observation,recommended_change,target_phase')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('status', 'active');
  if (learningError) throw learningError;

  const research = await executeWithBudget(
    client,
    'searchWeb',
    {
      query: `${buildAudienceEvidenceQuery(profile)} Focus the research on this edited audience: ${audience.name}. Problem: ${audience.problem_use_case_fit}. Triggers: ${(audience.purchase_triggers ?? []).join(', ')}`,
      numResults: 8,
      approvedLearnings: approvedLearnings ?? [],
    },
    {
      productId: input.productId,
      jobId: input.jobId,
      actor: input.actor,
      estimatedCost: input.estimatedCost,
    },
    `audience-rediscovery-research:${audience.id}:${audience.audience_version}`,
    true,
  );
  if (research.status === 'paused_budget') return research;
  const validatingEvidence =
    research.status === 'executed' && research.result.success
      ? normalizeResearchEvidence(research.result.data)
      : [];

  const result = await executeWithBudget(
    client,
    'reasoning',
    {
      task: 'rediscover_audience',
      canonicalProductProfile: profile,
      editedAudience: audience,
      validatingEvidence,
      approvedLearnings: approvedLearnings ?? [],
      outputRequirements: {
        recommendedValidationFields: [
          'budgetFit',
          'purchaseReadiness',
          'commercialEvidence',
          'validationRationale',
          'commercialIntentScore',
        ],
      },
      constraints: {
        doNotApprove: true,
        doNotInventEvidence: true,
        format: 'JSON only',
        audienceCount:
          'Return exactly one revised audience for the edited audience target.',
      },
    },
    {
      productId: input.productId,
      jobId: input.jobId,
      actor: input.actor,
      estimatedCost: input.estimatedCost,
    },
    `audience-rediscovery:${audience.id}:v${audience.audience_version}`,
  );
  if (result.status !== 'executed' || !result.result.success) return result;

  const payload = result.result.data as { audiences?: Array<Record<string, unknown>> };
  const candidate =
    Array.isArray(payload.audiences) && payload.audiences[0]
      ? payload.audiences[0]
      : null;
  if (!candidate) throw new Error('Audience research returned no revised audience. The edited audience has been preserved; retry discovery.');
  if (typeof candidate.problemUseCaseFit !== 'string' || !candidate.problemUseCaseFit.trim())
    throw new Error('Audience research returned an invalid problem summary. The edited audience has been preserved.');
  const strategy = deriveAudienceStrategy(candidate);
  const evidence = Array.isArray(candidate.supportingEvidence)
    ? candidate.supportingEvidence
    : validatingEvidence;
  const problemFit = String(
    candidate.problemUseCaseFit ?? audience.problem_use_case_fit ?? '',
  ).trim();
  const fitAssessment = String(
    candidate.aiFitAssessment ?? audience.ai_fit_assessment ?? '',
  ).trim();
  const purchaseTriggers = Array.isArray(candidate.purchaseTriggers)
    ? candidate.purchaseTriggers
    : (audience.purchase_triggers ?? []);
  const terminology = Array.isArray(candidate.relevantTerminology)
    ? candidate.relevantTerminology
    : (audience.relevant_terminology ?? []);
  const buyingBehavior =
    candidate.buyingBehavior && typeof candidate.buyingBehavior === 'object'
      ? (candidate.buyingBehavior as Record<string, unknown>)
      : (audience.buying_behavior ?? {});
  const commercialEvidence = Array.isArray(candidate.commercialEvidence)
    ? candidate.commercialEvidence
    : [];
  const audienceDisplayLabels = normalizeAudienceLabels(candidate.displayLabels, {
    purchaseTriggers,
  });
  const { error: updateError } = await client
    .from('sales_os_audiences')
    .update({
      name: String(candidate.name ?? audience.name),
      display_labels: audienceDisplayLabels,
      buyer_type:
        candidate.buyerType === 'organization' ? 'organization' : 'individual',
      outreach_motion: strategy.motion,
      outreach_motion_reason: strategy.reason,
      collateral_strategy: strategy.collateral,
      audience_summary: problemFit,
      problem_use_case_fit: problemFit,
      buying_behavior: buyingBehavior,
      purchase_triggers: purchaseTriggers,
      relevant_terminology: terminology,
      supporting_evidence: evidence,
      reachability_evidence: evidence,
      evidence_score:
        evidence.length >= 3 ? 'high' : evidence.length >= 1 ? 'medium' : 'low',
      evidence_score_detail: { evidenceCount: evidence.length, rediscovered: true },
      ai_fit_assessment: fitAssessment,
      priority: ['low', 'high'].includes(String(candidate.priority))
        ? candidate.priority
        : 'medium',
      quality_gate: {
        requiredFieldsPresent: Boolean(problemFit && fitAssessment && evidence.length),
        requiresHumanReview: true,
        rediscovered: true,
      },
      validation_status: 'pending_review',
      validation_evidence: commercialEvidence,
      commercial_intent_score:
        typeof candidate.commercialIntentScore === 'number'
          ? Math.min(1, Math.max(0, candidate.commercialIntentScore))
          : null,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('id', audience.id);
  if (updateError) throw updateError;

  const routes = ensureRoutes(candidate.routes, strategy);
  for (const route of routes) {
    if (!['social', 'direct'].includes(String(route.routeType))) continue;
    const { error: routeError } = await client.from('sales_os_audience_routes').upsert(
      {
        tenant_id: tenantId,
        product_id: input.productId,
        audience_id: audience.id,
        route_type: route.routeType,
        status: 'proposed',
        rationale: String(route.rationale ?? strategy.reason),
        search_strategy: route.searchStrategy ?? {},
        collateral_type: String(
          route.collateralType ?? strategy.collateral.primaryType,
        ),
        auto_discover: true,
        created_by: input.actor,
        updated_by: input.actor,
        state_changed_by: input.actor,
      },
      { onConflict: 'tenant_id,audience_id,route_type' },
    );
    if (routeError) throw routeError;
  }
  for (const route of routes) {
    if (!['social', 'direct'].includes(String(route.routeType))) continue;
    const channel =
      route.routeType === 'direct'
        ? 'email'
        : strategy.motion === 'b2b'
          ? 'professional_social'
          : strategy.motion === 'community'
            ? 'community'
            : 'reddit';
    const { data: decision, error: decisionError } = await client
      .from('sales_os_outreach_decisions')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: input.productId,
          product_profile_id: profile.id,
          icp_id: audience.icp_id,
          icp_version: audience.icp_version,
          audience_id: audience.id,
          audience_version: audience.audience_version,
          channel,
          outreach_motion: strategy.motion,
          objective:
            problemFit ||
            'Advance a qualified audience toward the product conversion goal.',
          rationale: String(route.rationale ?? strategy.reason),
          display_labels: decisionDisplayLabels({
            channel,
            motion: strategy.motion,
            conversionEvent: (profile.conversion_event ?? {}) as Record<
              string,
              unknown
            >,
            isFallback:
              (route.searchStrategy as Record<string,unknown> | undefined)?.generatedBy === 'icp_strategy_fallback_v1',
          }),
          collateral_type: String(
            route.collateralType ?? strategy.collateral.primaryType,
          ),
          cta: strategy.collateral.cta ?? null,
          strategy: {
            determinedFrom: 'rediscovered_audience',
            routeType: route.routeType,
            audienceId: audience.id,
          },
          status: 'proposed',
          version: 1,
          created_by: input.actor,
          updated_by: input.actor,
          state_changed_by: input.actor,
        },
        { onConflict: 'tenant_id,audience_id,channel,version' },
      )
      .select('id')
      .single();
    if (decisionError) throw decisionError;
    await recordWorkflowLineage(client, {
      productId: input.productId,
      relationType: 'audience_to_outreach_decision',
      audienceId: audience.id,
      outreachDecisionId: decision.id,
      actor: input.actor,
    });
  }
  await recordWorkflowLineage(client, {
    productId: input.productId,
    relationType: 'icp_to_audience',
    icpId: audience.icp_id,
    audienceId: audience.id,
    actor: input.actor,
  });
  return {
    ...result,
    persistedAudienceIds: [audience.id],
    rediscoveredAudienceId: audience.id,
    providerShape: describeShape(result.result.data),
  };
}

function buildDeterministicAudience(profile: Record<string, unknown>) {
  const problems = Array.isArray(profile.problems_solved)
    ? profile.problems_solved.map(String).filter(Boolean)
    : [];
  const useCases = Array.isArray(profile.primary_use_cases)
    ? profile.primary_use_cases.map(String).filter(Boolean)
    : [];
  const profileEvidence = Array.isArray(profile.source_evidence)
    ? profile.source_evidence
    : [];
  const evidence = profileEvidence.length
    ? profileEvidence
    : [
        {
          snippet:
            String(profile.description ?? '').trim() || 'Product profile evidence.',
          sourceType: 'product_profile',
        },
      ];
  const pricing =
    profile.pricing_business_model && typeof profile.pricing_business_model === 'object'
      ? (profile.pricing_business_model as Record<string, unknown>)
      : {};
  const motion =
    normalizeMotion(profile.outreach_motion) ??
    (String(pricing.buyerType ?? '').toLowerCase() === 'organization' ? 'b2b' : 'b2c');
  const labels =
    profile.display_labels && typeof profile.display_labels === 'object'
      ? (profile.display_labels as Record<string, unknown>)
      : {};
  const problemLabels = Array.isArray(labels.problemsSolved)
    ? labels.problemsSolved
    : [];
  const firstProblemLabel = problemLabels.find(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).label === 'string',
  ) as Record<string, unknown> | undefined;
  const problem = String(
    firstProblemLabel?.label ?? problems[0] ?? profile.description ?? '',
  ).trim();
  const buyerNoun = motion === 'b2b' ? 'Teams' : 'People';
  const name = `${buyerNoun} facing ${shortenWorkerText(problem, 5).toLowerCase()}`;
  const fallbackReason = 'Audience research returned no usable result.';
  return {
    name:
      name || `${shortenWorkerText(String(profile.category ?? 'Product'), 4)} buyers`,
    buyerType: motion === 'b2b' ? 'organization' : 'individual',
    outreachMotion: motion,
    outreachMotionReason: 'Based on your sales profile. Review before approving.',
    collateralStrategy: collateralForMotion(motion),
    problemUseCaseFit: problem,
    buyingBehavior: { source: 'product_profile_fallback', fallbackReason, useCases },
    budgetFit: 'Pending human review',
    purchaseReadiness: 'Pending human review',
    commercialEvidence: [],
    validationRationale:
      'Commercial validation was not established by the supplied product material and requires human review.',
    purchaseTriggers: Array.isArray(profile.purchase_triggers)
      ? profile.purchase_triggers
      : [],
    relevantTerminology: [],
    supportingEvidence: evidence,
    aiFitAssessment:
      'Built from your sales profile because audience research returned no usable result.',
    displayLabels: { name, problem: shortenWorkerText(problem, 15) },
    priority: 'medium',
    routes: [],
  };
}

function shortenWorkerText(value: string, maxWords: number) {
  const clean = value.replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean);
  return words.length <= maxWords ? clean : `${words.slice(0, maxWords).join(' ')}…`;
}

type OutreachMotion = 'b2b' | 'b2c' | 'b2b2c' | 'community';

type AudienceStrategy = {
  motion: OutreachMotion;
  reason: string;
  collateral: {
    primaryType: string;
    channels: string[];
    cta: string;
    tone: string;
  };
};

function deriveAudienceStrategy(audience: Record<string, unknown>): AudienceStrategy {
  const explicit = normalizeMotion(audience.outreachMotion);
  const buyerType =
    audience.buyerType === 'organization' ? 'organization' : 'individual';
  const routes = Array.isArray(audience.routes) ? audience.routes : [];
  const routeTypes = routes
    .filter((route): route is Record<string, unknown> =>
      Boolean(route && typeof route === 'object'),
    )
    .map((route) => String(route.routeType ?? '').toLowerCase());
  const motion =
    explicit ??
    (buyerType === 'organization'
      ? routeTypes.includes('social') && routeTypes.includes('direct')
        ? 'b2b2c'
        : 'b2b'
      : routeTypes.includes('direct')
        ? 'b2b2c'
        : routeTypes.includes('social')
          ? 'community'
          : 'b2c');
  const reason = String(
    audience.outreachMotionReason ??
      `Derived from ${buyerType} buyer type and the available acquisition signals.`,
  );
  return {
    motion,
    reason,
    collateral: collateralForMotion(motion),
  };
}

function normalizeMotion(value: unknown): OutreachMotion | null {
  const normalized = String(value ?? '')
    .toLowerCase()
    .trim();
  return ['b2b', 'b2c', 'b2b2c', 'community'].includes(normalized)
    ? (normalized as OutreachMotion)
    : null;
}

function collateralForMotion(motion: OutreachMotion) {
  if (motion === 'b2b')
    return {
      primaryType: 'personalized_email',
      channels: ['email', 'professional_social'],
      cta: 'Request a conversation or product walkthrough.',
      tone: 'specific, outcome-oriented, professional',
    };
  if (motion === 'b2b2c')
    return {
      primaryType: 'segmented_email_and_community',
      channels: ['email', 'community', 'professional_social'],
      cta: 'Choose the CTA appropriate to the buyer role.',
      tone: 'role-specific and evidence-led',
    };
  if (motion === 'community')
    return {
      primaryType: 'public_conversation_response',
      channels: ['reddit', 'community', 'professional_social'],
      cta: 'Offer a useful response and transparent next step.',
      tone: 'helpful, transparent, non-promotional',
    };
  return {
    primaryType: 'signup_focused_social_content',
    channels: ['reddit', 'community', 'professional_social'],
    cta: 'Invite a low-friction signup or trial.',
    tone: 'plain-language, benefit-led, approachable',
  };
}

function ensureRoutes(value: unknown, strategy: AudienceStrategy) {
  const provided = Array.isArray(value)
    ? value.filter(
        (route): route is Record<string, unknown> =>
          Boolean(route && typeof route === 'object') &&
          ['social', 'direct'].includes(
            String((route as Record<string, unknown>).routeType),
          ),
      )
    : [];
  if (provided.length > 0) {
    // Organization audiences must always have a direct route so the approved
    // workflow can discover named accounts, contacts, and verified emails.
    if (
      ['b2b', 'b2b2c'].includes(strategy.motion) &&
      !provided.some((route) => String(route.routeType).toLowerCase() === 'direct')
    ) {
      provided.push({
        routeType: 'direct',
        rationale:
          'Suggested for direct contact discovery from the business sales motion.',
        searchStrategy: {
          generatedBy: 'icp_strategy_enforced_direct_v1',
          motion: strategy.motion,
        },
        collateralType: strategy.collateral.primaryType,
      });
    }
    return provided;
  }
  const routeTypes =
    strategy.motion === 'b2b'
      ? ['direct']
      : strategy.motion === 'b2b2c'
        ? ['direct', 'social']
        : ['social'];
  return routeTypes.map((routeType) => ({
    routeType,
    rationale: `Suggested from your ${strategy.motion === 'b2b' ? 'business' : strategy.motion === 'b2c' ? 'consumer' : strategy.motion === 'b2b2c' ? 'mixed' : 'community'} sales motion.`,
    searchStrategy: {
      generatedBy: 'icp_strategy_fallback_v1',
      motion: strategy.motion,
    },
    collateralType: strategy.collateral.primaryType,
  }));
}

export async function runFindForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
) {
  const { job, actor } = input;
  const audienceId = String(job.input.audienceId ?? '');
  const routeId = String(job.input.routeId ?? '');
  if (!audienceId || !routeId)
    throw new Error('Find jobs require an audienceId and routeId.');
  const { data: route, error: routeError } = await client
    .from('sales_os_audience_routes')
    .select('id,audience_id,route_type,status,search_strategy')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('id', routeId)
    .eq('audience_id', audienceId)
    .single();
  if (routeError) throw routeError;
  if (!['approved', 'active'].includes(route.status))
    throw new Error('Find requires an approved or active route.');
  if (route.route_type === 'direct') {
    return runDirectFindForWorker(client, { job, actor, audienceId, routeId });
  }
  return runSocialFindForWorker(client, { job, actor, audienceId, routeId });

}

async function runSocialFindForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string; audienceId: string; routeId: string },
) {
  const { job, actor, audienceId, routeId } = input;
  const [
    { data: audience, error: audienceError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    client
      .from('sales_os_audiences')
      .select(
        'id,name,problem_use_case_fit,purchase_triggers,relevant_terminology,status',
      )
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('id', audienceId)
      .single(),
    client
      .from('sales_os_product_profiles')
      .select('problems_solved,primary_use_cases,purchase_triggers')
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('is_active', true)
      .eq('review_status', 'approved')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (audienceError) throw audienceError;
  if (profileError) throw profileError;
  if (!audience || !['approved', 'active'].includes(audience.status))
    throw new Error('Social Find requires an approved or active audience.');

  const { data: signals, error: signalsError } = await client
    .from('sales_os_signals')
    .select('id,name,description,signal_type,specificity,status')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('audience_id', audienceId)
    .eq('status', 'active');
  if (signalsError) throw signalsError;
  const activeSignals = (signals ?? []) as Array<Record<string, unknown>>;
  const { data: approvedLearnings, error: learningError } = await client
    .from('sales_os_learnings')
    .select('observation,recommended_change,target_phase')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('status', 'active');
  if (learningError) throw learningError;
  const searchTerms = [
    audience.name,
    audience.problem_use_case_fit,
    ...(Array.isArray(audience.purchase_triggers) ? audience.purchase_triggers : []),
    ...(Array.isArray(audience.relevant_terminology)
      ? audience.relevant_terminology
      : []),
  ].filter((value): value is string => typeof value === 'string' && !!value.trim());
  const search = await executeWithBudget(
    client,
    'searchCommunity',
    {
      query: String(job.input.query ?? searchTerms.slice(0, 6).join(' ')),
      numResults: 20,
      signalTypes: activeSignals.map((signal) => signal.signal_type),
      approvedLearnings: approvedLearnings ?? [],
      searchPlanVersion: 'social_search_plan_v1',
    },
    {
      productId: job.product_id,
      jobId: job.id,
      actor,
      estimatedCost: Number(job.estimated_cost ?? 0),
    },
    `social-find:${job.id}`,
    true,
  );
  if (search.status !== 'executed' || !search.result.success) return search;

  const candidates = normalizeCommunityResults(search.result.data, job.product_id);
  const savedOpportunityIds: string[] = [];
  const rejectedReasons: Record<string, number> = {};
  for (const candidate of candidates) {
    const recencyDays = candidate.publishedAt
      ? Math.max(
          0,
          Math.floor((Date.now() - Date.parse(candidate.publishedAt)) / 86_400_000),
        )
      : null;
    const evidence = [
      {
        url: candidate.canonicalUrl,
        excerpt: candidate.excerpt,
        sourceType: candidate.sourceType,
        observedAt: candidate.publishedAt,
        metadata: candidate.metadata,
      },
    ];
    const specificity = candidate.signalSpecificity;
    const score = scoreWorkerEvidence(1, 1, specificity, recencyDays);
    if (score.score === 'low') {
      rejectedReasons.evidence_score_below_threshold =
        (rejectedReasons.evidence_score_below_threshold ?? 0) + 1;
      continue;
    }
    const { data: duplicate } = await client
      .from('sales_os_opportunities')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('dedupe_key', candidate.dedupeKey)
      .maybeSingle();
    if (duplicate) {
      rejectedReasons.duplicate_opportunity =
        (rejectedReasons.duplicate_opportunity ?? 0) + 1;
      continue;
    }
    const { data: suppressed, error: suppressionError } = await client
      .from('sales_os_suppression_records')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .in('channel', ['reddit', 'community', 'professional_social'])
      .eq('active', true)
      .in('identifier', [candidate.canonicalUrl, candidate.externalId ?? '']);
    if (suppressionError) throw suppressionError;
    if ((suppressed ?? []).length > 0) {
      rejectedReasons.suppressed = (rejectedReasons.suppressed ?? 0) + 1;
      continue;
    }
    const signal = await ensureSocialSignal(client, {
      productId: job.product_id,
      audienceId,
      candidate,
      activeSignals,
      actor,
    });
    const { data: source, error: sourceError } = await client
      .from('sales_os_sources')
      .insert({
        tenant_id: tenantId,
        product_id: job.product_id,
        provider_id: null,
        source_type: candidate.sourceType,
        name: candidate.sourceName,
        url: candidate.canonicalUrl,
        external_id: candidate.externalId ?? null,
        metadata: { ...candidate.metadata, provider: search.result.provider },
        created_by: actor,
        updated_by: actor,
      })
      .select('id')
      .single();
    if (sourceError) throw sourceError;
    const { data: opportunity, error: opportunityError } = await client
      .from('sales_os_opportunities')
      .insert({
        tenant_id: tenantId,
        product_id: job.product_id,
        audience_id: audienceId,
        route_type: 'social',
        source_id: source.id,
        signal_id: signal.id,
        title: candidate.title,
        summary: candidate.excerpt,
        evidence,
        evidence_score: score.score,
        evidence_score_detail: score.detail,
        signal_type: candidate.signalType,
        fit_score: specificity,
        qualification_reason:
          'Community evidence, signal specificity, dedupe, and suppression checks passed.',
        suppression_checked: true,
        ai_fit_assessment: `Signal matches the approved audience ${audience.name}; human review must confirm commercial fit.`,
        recommended_action: recommendedSocialAction(candidate.signalType),
        status: 'awaiting_review',
        discovered_at: candidate.publishedAt ?? new Date().toISOString(),
        dedupe_key: candidate.dedupeKey,
        first_touch_dimensions: {
          sourceType: candidate.sourceType,
          signalType: candidate.signalType,
          provider: search.result.provider,
        },
        created_by: actor,
        updated_by: actor,
        state_changed_by: actor,
      })
      .select('id')
      .single();
    if (opportunityError) throw opportunityError;
    if (opportunity) savedOpportunityIds.push(opportunity.id);
  }
  return {
    ...search,
    savedOpportunityIds,
    progress: {
      discovered: candidates.length,
      qualified: savedOpportunityIds.length,
      rejected: candidates.length - savedOpportunityIds.length,
      rejectedReasons,
    },
  };
}

async function runDirectFindForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string; audienceId: string; routeId: string },
) {
  const { job, actor, audienceId } = input;
  const [
    { data: product, error: productError },
    { data: audience, error: audienceError },
  ] = await Promise.all([
    client
      .from('sales_os_products')
      .select('name,website_url,description_input,geographic_constraints')
      .eq('tenant_id', tenantId)
      .eq('id', job.product_id)
      .single(),
    client
      .from('sales_os_audiences')
      .select(
        'name,problem_use_case_fit,buying_behavior,purchase_triggers,relevant_terminology,status,icp_id',
      )
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('id', audienceId)
      .single(),
  ]);
  if (productError) throw productError;
  if (audienceError) throw audienceError;
  if (!['approved', 'active'].includes(audience.status))
    throw new Error('Direct discovery requires an approved audience.');
  const {data: icp, error: icpError} = await client.from('sales_os_icps')
    .select('*').eq('tenant_id',tenantId).eq('product_id',job.product_id)
    .eq('id',audience.icp_id).single();
  if (icpError) throw icpError;
  if (!['approved','active'].includes(icp.status))
    throw new Error('Approve the parent ICP before finding contacts.');
  const {data: profile, error: profileError} = await client.from('sales_os_product_profiles')
    .select('*').eq('tenant_id',tenantId).eq('product_id',job.product_id)
    .eq('review_status','approved').eq('is_active',true).order('version',{ascending:false}).limit(1).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error('Direct discovery requires an approved sales profile.');
  for (const capability of ['findCompany','findPerson','findContact','verifyContact']) {
    if (!(await loadProviders(client,capability)).length)
      throw new Error(`Contact discovery is not configured: no enabled provider for ${capability}.`);
  }
  const { data: approvedLearnings, error: learningError } = await client
    .from('sales_os_learnings')
    .select('observation,recommended_change,target_phase')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('status', 'active');
  if (learningError) throw learningError;
  const workerInput = {
    productId: job.product_id,
    jobId: job.id,
    currentProductStatus: 'analyzing' as const,
    productContext: product as Record<string, unknown>,
    estimatedCost: Number(job.estimated_cost ?? 0),
    actor,
  };
  const definition = await ensureAudienceDefinition(client, {
    productId: job.product_id,
    icpId: audience.icp_id,
    audienceId,
    actor,
    audience,
  });
  const accountResult = await executeWithBudget(
    client,
    'findCompany',
    { product, profile, icp, audience, approvedLearnings: approvedLearnings ?? [] },
    workerInput,
    `direct-find-company:${job.id}`,
    true,
  );
  if (accountResult.status !== 'executed' || !accountResult.result.success)
    return accountResult;
  const accounts = directCandidates(accountResult.result.data).filter(
    (item) =>
      typeof item.name === 'string' &&
      typeof item.domain === 'string' &&
      typeof item.websiteUrl === 'string',
  );
  const discoveryCounts = {accounts:accounts.length,people:0,emails:0,verified:0,suppressed:0,ready:0};
  async function recordProgress(stage:string) {
    const {error}=await client.from('sales_os_jobs').update({progress:{stage,...discoveryCounts},last_heartbeat_at:new Date().toISOString()})
      .eq('tenant_id',tenantId).eq('product_id',job.product_id).eq('id',job.id).eq('status','running');
    if(error)throw error;
  }
  await recordProgress('accounts_found');
  const savedOpportunityIds: string[] = [];
  for (const accountCandidate of accounts) {
    const domain = normalizeDirectDomain(String(accountCandidate.domain));
    const accountEvidence = directEvidence(accountCandidate.evidence);
    if (!domain || accountEvidence.length === 0) continue;
    const { data: account, error: accountError } = await client
      .from('sales_os_accounts')
      .upsert(
        {
          tenant_id: tenantId,
          product_id: job.product_id,
          name: String(accountCandidate.name),
          domain,
          website_url: String(accountCandidate.websiteUrl),
          industry: accountCandidate.industry ?? null,
          company_context: accountCandidate.companyContext ?? {},
          source_evidence: accountEvidence,
          created_by: actor,
          updated_by: actor,
        },
        { onConflict: 'tenant_id,product_id,normalized_domain' },
      )
      .select('id,name,domain')
      .single();
    if (accountError) throw accountError;
    await ensureAudienceMember(client, {
      productId: job.product_id,
      icpId: definition.icp_id,
      audienceId,
      definitionId: definition.id,
      accountId: account.id,
      sourceRecordId: domain,
      actor,
      confidence: 0.8,
      provenance: [
        { source: accountResult.result.provider, evidence: accountEvidence },
      ],
    });
    await recordProgress('finding_people');
    const personResult = await executeWithBudget(
      client,
      'findPerson',
      {
        product,
        audience,
        account: accountCandidate,
        approvedLearnings: approvedLearnings ?? [],
      },
      workerInput,
      `direct-find-person:${job.id}:${account.id}`,
      true,
    );
    if (personResult.status !== 'executed' || !personResult.result.success)
      throw new Error(personResult.result?.error?.message ?? 'Person discovery failed. Retry discovery to resume.');
    const targetRole = [
      (icp as Record<string, unknown>).decision_maker,
      (audience.buying_behavior as Record<string, unknown> | null)?.buyer,
      (audience.buying_behavior as Record<string, unknown> | null)?.decisionMaker,
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
    // Select the highest-ranked decision-makers before email lookup and
    // persistence so one company is never saturated with low-priority contacts.
    const people = rankContactCandidates(
      directCandidates(personResult.result.data),
      targetRole,
      3,
    );
    for (const person of people) {
      discoveryCounts.people += 1;
      await recordProgress('finding_email');
      const personEvidence = directEvidence(person.evidence);
      if (!personEvidence.length) continue;
      const contactResult = await executeWithBudget(
        client,
        'findContact',
        { account: accountCandidate, person },
        workerInput,
        `direct-find-contact:${job.id}:${account.id}:${String(person.fullName)}`,
        true,
      );
      if (contactResult.status !== 'executed' || !contactResult.result.success)
        throw new Error(contactResult.result?.error?.message ?? 'Email lookup failed. Retry discovery to resume.');
      const contactCandidate =
        contactResult.status === 'executed' && contactResult.result.success
          ? directCandidates(contactResult.result.data).find(
              (candidate) => typeof candidate.professionalEmail === 'string',
            )
          : undefined;
      let verification = contactCandidate;
      if (typeof contactCandidate?.professionalEmail === 'string') {
        discoveryCounts.emails += 1;
        await recordProgress('verifying_email');
        const verifyResult = await executeWithBudget(
          client,
          'verifyContact',
          { email: contactCandidate.professionalEmail },
          workerInput,
          `direct-verify-contact:${job.id}:${account.id}:${String(person.fullName)}`,
          true,
        );
        if (verifyResult.status !== 'executed' || !verifyResult.result.success)
          throw new Error(verifyResult.result?.error?.message ?? 'Email verification failed. Retry discovery to resume.');
        if (verifyResult.status === 'executed' && verifyResult.result.success)
          verification = {
            ...contactCandidate,
            ...directCandidates(verifyResult.result.data)[0],
          };
      }
      const email =
        typeof verification?.professionalEmail === 'string'
          ? verification.professionalEmail.trim().toLowerCase()
          : null;
      if (!email) {
        const partialId=await discoveryRecordId([tenantId,job.product_id,audienceId,account.id,String(person.fullName),String(person.professionalProfileUrl ?? '')]);
        const {error: partialError}=await client.from('sales_os_contacts').upsert({
          id:partialId,tenant_id:tenantId,product_id:job.product_id,account_id:account.id,
          full_name:String(person.fullName),title:person.title ?? null,
          professional_profile_url:person.professionalProfileUrl ?? null,
          source_evidence:personEvidence,created_by:actor,updated_by:actor,
        },{onConflict:'id'});
        if (partialError) throw partialError;
        await ensureAudienceMember(client,{productId:job.product_id,icpId:definition.icp_id,
          audienceId,definitionId:definition.id,contactId:partialId,sourceRecordId:partialId,
          actor,confidence:0.5,provenance:personEvidence,status:'needs_enrichment',consentState:'unknown',suppressionState:'not_checked'});
        continue;
      }
      const { data: suppressed, error: suppressionError } = await client
        .from('sales_os_suppression_records')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('product_id', job.product_id)
        .eq('channel', 'email')
        .eq('active', true)
        .ilike('identifier', email)
        .maybeSingle();
      if (suppressionError) throw suppressionError;
      if (suppressed) { discoveryCounts.suppressed += 1; await recordProgress('suppression_checked'); continue; }
      const evidence = [
        ...accountEvidence,
        ...personEvidence,
        ...directEvidence(verification?.evidence),
      ];
      const sourceTypes = new Set(
        evidence.map((item) => String(item.sourceType ?? 'unknown')),
      ).size;
      const weightedTotal =
        Math.min(evidence.length / 4, 1) * 0.25 +
        Math.min(sourceTypes / 3, 1) * 0.25 +
        (verification?.verificationStatus === 'valid' ? 1 : 0.5) * 0.25 +
        0.25;
      const evidenceScore =
        weightedTotal >= 0.75 ? 'high' : weightedTotal >= 0.45 ? 'medium' : 'low';
      if (evidenceScore === 'low') continue;
      const { data: contact, error: contactError } = await client
        .from('sales_os_contacts')
        .upsert(
          {
            tenant_id: tenantId,
            product_id: job.product_id,
            account_id: account.id,
            full_name: String(person.fullName),
            title: typeof person.title === 'string' ? person.title : null,
            professional_profile_url:
              typeof person.professionalProfileUrl === 'string'
                ? person.professionalProfileUrl
                : null,
            professional_email: email,
            email_verification_status: verification?.verificationStatus ?? 'unknown',
            email_verification_provider: verification?.verificationProvider ?? null,
            source_evidence: evidence,
            last_verified_at:
              typeof verification?.verifiedAt === 'string' ? verification.verifiedAt : null,
            created_by: actor,
            updated_by: actor,
          },
          { onConflict: 'tenant_id,product_id,normalized_email' },
        )
        .select('id')
        .single();
      if (contactError) throw contactError;
      const emailReady = isFreshVerifiedEmail(verification?.verificationStatus,verification?.verifiedAt);
      const contactMemberId = await ensureAudienceMember(client, {
        productId: job.product_id,
        icpId: definition.icp_id,
        audienceId,
        definitionId: definition.id,
        contactId: contact.id,
        sourceRecordId: email,
        actor,
        confidence: verification?.verificationStatus === 'valid' ? 1 : 0.75,
        provenance: [{ source: contactResult.result.provider, evidence }],
        consentState: 'unknown',
        suppressionState: 'clear',
        status:
          emailReady ? 'ready' : 'needs_enrichment',
      });
      await recordIdentityCandidatesForContact(client, {
        productId: job.product_id,
        memberId: contactMemberId,
        contactId: contact.id,
        fullName: String(person.fullName),
        title: typeof person.title === 'string' ? person.title : null,
        actor,
        provenance: evidence,
      });
      // Fit evidence never substitutes for deliverability verification.
      if (!emailReady) continue;
      discoveryCounts.verified += 1;
      const sourceUrl = String(accountCandidate.websiteUrl);
      const { data: source, error: sourceError } = await client
        .from('sales_os_sources')
        .upsert(
          {
            id: await discoveryRecordId([tenantId,job.product_id,'company_source',sourceUrl]),
            tenant_id: tenantId,
            product_id: job.product_id,
            source_type: 'company_site',
            name: String(account.name),
            url: sourceUrl,
            metadata: {
              discoveryMode: 'direct_enrichment',
              provider: accountResult.result.provider,
            },
            created_by: actor,
            updated_by: actor,
          },
          { onConflict: 'tenant_id,id' },
        )
        .select('id')
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (!source) continue;
      const { data: directSignal, error: directSignalError } = await client
        .from('sales_os_signals')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('product_id', job.product_id)
        .eq('audience_id', audienceId)
        .eq('signal_type', 'direct_contact_fit')
        .eq('status', 'active')
        .maybeSingle();
      if (directSignalError) throw directSignalError;
      let signalId = directSignal?.id ?? null;
      if (!signalId) {
        const { data: createdSignal, error: createdSignalError } = await client
          .from('sales_os_signals')
          .insert({
            tenant_id: tenantId,
            product_id: job.product_id,
            audience_id: audienceId,
            name: 'direct contact fit',
            description:
              'Organization, role, contact, and verification evidence match the audience.',
            signal_type: 'direct_contact_fit',
            specificity: verification?.verificationStatus === 'valid' ? 1 : 0.75,
            status: 'active',
            origin: 'initial_analysis',
            created_by: actor,
            updated_by: actor,
          })
          .select('id')
          .single();
        if (createdSignalError) throw createdSignalError;
        signalId = createdSignal.id;
      }
      const dedupeKey = `${tenantId}:${job.product_id}:${audienceId}:direct:${domain}:${email}`;
      const { data: opportunity, error: opportunityError } = await client
        .from('sales_os_opportunities')
        .upsert(
          {
            tenant_id: tenantId,
            product_id: job.product_id,
            audience_id: audienceId,
            route_type: 'direct',
            source_id: source.id,
            signal_id: signalId,
            account_id: account.id,
            contact_id: contact.id,
            title: `${String(person.fullName)} at ${String(account.name)}`,
            summary: `${String(person.title ?? 'Contact')} at ${String(account.name)}. Review their role and organization against the approved audience before outreach.`,
            evidence,
            evidence_score: evidenceScore,
            signal_type: 'direct_contact_fit',
            fit_score: verification?.verificationStatus === 'valid' ? 1 : 0.75,
            qualification_reason:
              'Professional email verified and suppression checked. Buyer-role fit requires review.',
            suppression_checked: true,
            evidence_score_detail: {
              rubricVersion: 'evidence_v1',
              evidenceCount: evidence.length,
              sourceDiversity: sourceTypes,
              verified: verification?.verificationStatus === 'valid',
              weightedTotal,
            },
            ai_fit_assessment: `Potential fit for ${String(audience.name)} based on account, person, and verified contact evidence.`,
            recommended_action: 'Review evidence before email engagement.',
            status: 'awaiting_review',
            dedupe_key: dedupeKey,
            first_touch_dimensions: {
              routeType: 'direct',
              emailReady: verification?.verificationStatus === 'valid',
              provider: accountResult.result.provider,
            },
            created_by: actor,
            updated_by: actor,
            state_changed_by: actor,
          },
          { onConflict: 'tenant_id,product_id,dedupe_key', ignoreDuplicates: true },
        )
        .select('id')
        .maybeSingle();
      if (opportunityError) throw opportunityError;
      if (opportunity) savedOpportunityIds.push(opportunity.id);
      discoveryCounts.ready += 1;
      await recordProgress('contacts_saved');
    }
  }
  await recordProgress('completed');
  return { ...accountResult, savedOpportunityIds, discoveryCounts };
}

async function ensureAudienceDefinition(
  client: SupabaseClient,
  input: {
    productId: string;
    icpId: string;
    audienceId: string;
    actor: string;
    audience: Record<string, unknown>;
  },
) {
  const { data: existing, error: existingError } = await client
    .from('sales_os_audience_definitions')
    .select('id,icp_id,version')
    .eq('tenant_id', tenantId)
    .eq('audience_id', input.audienceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;
  const { data: audience, error: audienceError } = await client
    .from('sales_os_audiences')
    .select('id,icp_id,audience_version,name,buyer_type,problem_use_case_fit,status')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('id', input.audienceId)
    .single();
  if (audienceError) throw audienceError;
  const { data, error } = await client
    .from('sales_os_audience_definitions')
    .insert({
      tenant_id: tenantId,
      product_id: input.productId,
      icp_id: audience.icp_id,
      audience_id: input.audienceId,
      version: Number(audience.audience_version ?? 1),
      definition_kind: 'snapshot',
      name: audience.name,
      description: audience.problem_use_case_fit ?? audience.name,
      rule_definition: {
        buyerType: audience.buyer_type,
        audienceVersion: audience.audience_version,
      },
      source_system: 'sales_os',
      source_record_id: input.audienceId,
      confidence: 0.8,
      provenance: [{ source: 'approved_audience', audienceId: input.audienceId }],
      consent_state: 'unknown',
      status: ['approved', 'active'].includes(String(audience.status))
        ? 'active'
        : 'proposed',
      created_by: input.actor,
      updated_by: input.actor,
      state_changed_by: input.actor,
    })
    .select('id,icp_id,version')
    .single();
  if (error) throw error;
  return data;
}

async function ensureAudienceMember(
  client: SupabaseClient,
  input: {
    productId: string;
    icpId: string;
    audienceId: string;
    definitionId: string;
    accountId?: string;
    contactId?: string;
    sourceRecordId: string;
    actor: string;
    confidence: number;
    provenance: unknown[];
    consentState?: string;
    suppressionState?: string;
    status?: string;
  },
) {
  const identityColumn = input.accountId ? 'account_id' : 'contact_id';
  const identityValue = input.accountId ?? input.contactId;
  if (!identityValue)
    throw new Error('Audience member requires an account or contact.');
  const { data: current, error: currentError } = await client
    .from('sales_os_audience_members')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('definition_id', input.definitionId)
    .eq('source_system', 'sales_os')
    .eq('source_record_id', input.sourceRecordId)
    .maybeSingle();
  if (currentError) throw currentError;
  const payload = {
    tenant_id: tenantId,
    product_id: input.productId,
    icp_id: input.icpId,
    audience_id: input.audienceId,
    definition_id: input.definitionId,
    account_id: input.accountId ?? null,
    contact_id: input.contactId ?? null,
    identity_type: input.accountId ? 'company' : 'person',
    source_system: 'sales_os',
    source_record_id: input.sourceRecordId,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    confidence: input.confidence,
    provenance: input.provenance,
    consent_state: input.consentState ?? 'unknown',
    suppression_state: input.suppressionState ?? 'not_checked',
    status: input.status ?? 'needs_enrichment',
    created_by: input.actor,
    updated_by: input.actor,
  };
  if (current) {
    const { error } = await client
      .from('sales_os_audience_members')
      .update({ ...payload, [identityColumn]: identityValue })
      .eq('tenant_id', tenantId)
      .eq('id', current.id);
    if (error) throw error;
    return current.id;
  }
  const { data: created, error } = await client
    .from('sales_os_audience_members')
    .insert({ ...payload, [identityColumn]: identityValue })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}

async function recordIdentityCandidatesForContact(
  client: SupabaseClient,
  input: {
    productId: string;
    memberId: string;
    contactId: string;
    fullName: string;
    title: string | null;
    actor: string;
    provenance: unknown[];
  },
) {
  const { data: contacts, error } = await client
    .from('sales_os_contacts')
    .select('id,full_name,title')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .neq('id', input.contactId)
    .limit(100);
  if (error) throw error;
  const normalize = (value: string | null | undefined) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const name = normalize(input.fullName);
  for (const contact of contacts ?? []) {
    const candidateName = normalize(contact.full_name);
    if (!name || !candidateName || name !== candidateName) continue;
    const titleMatch =
      input.title &&
      contact.title &&
      normalize(input.title) === normalize(contact.title);
    const candidateError = await client.from('sales_os_identity_candidates').insert({
      tenant_id: tenantId,
      product_id: input.productId,
      member_id: input.memberId,
      candidate_contact_id: contact.id,
      candidate_type: 'person',
      confidence: titleMatch ? 0.9 : 0.75,
      match_basis: { normalizedName: true, titleMatch: Boolean(titleMatch) },
      provenance: input.provenance,
      match_type: 'candidate',
      threshold_version: 'identity_v1',
      status: 'pending',
      created_by: input.actor,
      updated_by: input.actor,
    });
    if (candidateError.error && candidateError.error.code !== '23505')
      throw candidateError.error;
  }
}

export async function enrichAudienceForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
) {
  const { job, actor } = input;
  const audienceId = String(job.input.audienceId ?? '');
  const definitionId = String(job.input.definitionId ?? '');
  if (!audienceId || !definitionId)
    throw new Error('Audience enrichment jobs require audienceId and definitionId.');
  const { data: members, error: memberError } = await client
    .from('sales_os_audience_members')
    .select(
      'id,account_id,contact_id,consent_state,suppression_state,status,freshness_at',
    )
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('audience_id', audienceId)
    .eq('definition_id', definitionId)
    .not('status', 'in', '(removed,suppressed,blocked)');
  if (memberError) throw memberError;
  let succeeded = 0;
  let partial = 0;
  let failed = 0;
  let skipped = 0;
  for (const member of members ?? []) {
    try {
      if (['restricted', 'revoked'].includes(String(member.consent_state))) {
        await client
          .from('sales_os_audience_members')
          .update({ status: 'blocked' })
          .eq('tenant_id', tenantId)
          .eq('id', member.id);
        skipped += 1;
        continue;
      }
      if (member.account_id) {
        const { data: account, error } = await client
          .from('sales_os_accounts')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('id', member.account_id)
          .single();
        if (error) throw error;
        const missing = ['name', 'domain', 'website_url', 'industry'].filter(
          (key) => !String(account[key] ?? '').trim(),
        );
        const stale =
          !account.last_enriched_at ||
          Date.parse(account.last_enriched_at) < Date.now() - 30 * 86400000;
        if (missing.length || stale) {
          await client
            .from('sales_os_accounts')
            .update({ enrichment_status: 'running', updated_by: actor })
            .eq('tenant_id', tenantId)
            .eq('id', account.id);
          const result = await executeWithBudget(
            client,
            'findCompany',
            { account },
            {
              productId: job.product_id,
              jobId: job.id,
              currentProductStatus: 'analyzing',
              productContext: {},
              estimatedCost: Number(job.estimated_cost ?? 0),
              actor,
            },
            `audience-enrichment-company:${job.id}:${account.id}`,
            true,
          );
          const candidate = directCandidates(result.result?.data)[0] ?? {};
          const next = {
            ...(candidate.name ? { name: candidate.name } : {}),
            ...(candidate.domain
              ? { domain: normalizeDirectDomain(String(candidate.domain)) }
              : {}),
            ...(candidate.websiteUrl ? { website_url: candidate.websiteUrl } : {}),
            ...(candidate.industry ? { industry: candidate.industry } : {}),
            ...(result.status === 'executed' && result.result?.success
              ? { enrichment_status: 'succeeded' }
              : {
                  enrichment_status: 'partial',
                  enrichment_error:
                    result.result?.error?.message ??
                    'Provider did not return a complete company record.',
                }),
            last_enriched_at: new Date().toISOString(),
            updated_by: actor,
          };
          await client
            .from('sales_os_accounts')
            .update(next)
            .eq('tenant_id', tenantId)
            .eq('id', account.id);
          await client.from('sales_os_enrichment_records').insert({
            tenant_id: tenantId,
            product_id: job.product_id,
            member_id: member.id,
            account_id: account.id,
            entity_type: 'company',
            provider_capability: 'findCompany',
            status:
              result.status === 'executed' && result.result?.success
                ? 'succeeded'
                : 'partial',
            data: {
              previous: account,
              updated: candidate,
              cost: result.result?.cost ?? 0,
            },
            provenance: [
              { provider: result.result?.provider ?? 'unknown', jobId: job.id },
            ],
            confidence:
              result.status === 'executed' && result.result.success ? 0.8 : 0.4,
            request_reference: `audience-enrichment-company:${job.id}:${account.id}`,
            retryable: Boolean(result.result?.error?.retryable),
            job_id: job.id,
            attempt: job.attempt,
            missing_fields: missing,
            latency_ms: result.result?.latencyMs ?? 0,
            completed_at: new Date().toISOString(),
          });
          if (result.status !== 'executed' || !result.result.success) partial += 1;
        }
      }
      if (member.contact_id) {
        const { data: contact, error: contactError } = await client
          .from('sales_os_contacts')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('id', member.contact_id)
          .single();
        if (contactError) throw contactError;
        const { data: contactAccount, error: contactAccountError } = member.account_id
          ? await client
              .from('sales_os_accounts')
              .select('id,name,domain,website_url,industry')
              .eq('tenant_id', tenantId)
              .eq('id', member.account_id)
              .maybeSingle()
          : { data: null, error: null };
        if (contactAccountError) throw contactAccountError;
        const needsVerification =
          String(contact.email_verification_status ?? '') !== 'valid';
        const missing = ['full_name', 'title', 'professional_email'].filter(
          (key) => !String(contact[key] ?? '').trim(),
        );
        if (missing.length || needsVerification) {
          await client
            .from('sales_os_contacts')
            .update({ enrichment_status: 'running', updated_by: actor })
            .eq('tenant_id', tenantId)
            .eq('id', contact.id);
          const result = await executeWithBudget(
            client,
            'findContact',
            { account: contactAccount ?? {}, person: contact, contact },
            {
              productId: job.product_id,
              jobId: job.id,
              currentProductStatus: 'analyzing',
              productContext: {},
              estimatedCost: Number(job.estimated_cost ?? 0),
              actor,
            },
            `audience-enrichment-contact:${job.id}:${contact.id}`,
            true,
          );
          const candidate = directCandidates(result.result?.data)[0] ?? {};
          const email =
            typeof candidate.professionalEmail === 'string'
              ? candidate.professionalEmail.trim().toLowerCase()
              : contact.professional_email;
          let verification = contact.email_verification_status;
          if (email) {
            const verify = await executeWithBudget(
              client,
              'verifyContact',
              { email },
              {
                productId: job.product_id,
                jobId: job.id,
                currentProductStatus: 'analyzing',
                productContext: {},
                estimatedCost: Number(job.estimated_cost ?? 0),
                actor,
              },
              `audience-enrichment-verify:${job.id}:${contact.id}`,
              true,
            );
            const verified = directCandidates(verify.result?.data)[0] ?? {};
            verification = verified.verificationStatus ?? verification;
          }
          const { data: suppressed, error: suppressionError } = await client
            .from('sales_os_suppression_records')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('product_id', job.product_id)
            .eq('channel', 'email')
            .eq('active', true)
            .ilike('identifier', email ?? '')
            .maybeSingle();
          if (suppressionError) throw suppressionError;
          const ready = !suppressed && verification === 'valid' && Boolean(email);
          await client
            .from('sales_os_contacts')
            .update({
              ...(candidate.fullName ? { full_name: candidate.fullName } : {}),
              ...(candidate.title ? { title: candidate.title } : {}),
              ...(email ? { professional_email: email } : {}),
              email_verification_status: verification,
              enrichment_status: ready ? 'succeeded' : 'partial',
              last_enriched_at: new Date().toISOString(),
              enrichment_error: ready
                ? null
                : 'Contact requires a verified, unsuppressed email.',
              updated_by: actor,
            })
            .eq('tenant_id', tenantId)
            .eq('id', contact.id);
          await client
            .from('sales_os_audience_members')
            .update({
              status: suppressed ? 'suppressed' : ready ? 'ready' : 'needs_enrichment',
              suppression_state: suppressed ? 'suppressed' : 'clear',
              last_seen_at: new Date().toISOString(),
              updated_by: actor,
            })
            .eq('tenant_id', tenantId)
            .eq('id', member.id);
          await client.from('sales_os_enrichment_records').insert({
            tenant_id: tenantId,
            product_id: job.product_id,
            member_id: member.id,
            contact_id: contact.id,
            entity_type: 'contact',
            provider_capability: 'findContact',
            status: ready ? 'succeeded' : 'partial',
            data: {
              previous: contact,
              updated: {
                ...candidate,
                professionalEmail: email,
                verificationStatus: verification,
              },
              cost: result.result?.cost ?? 0,
            },
            provenance: [
              { provider: result.result?.provider ?? 'unknown', jobId: job.id },
            ],
            confidence: ready ? 1 : 0.4,
            request_reference: `audience-enrichment-contact:${job.id}:${contact.id}`,
            retryable: Boolean(result.result?.error?.retryable),
            job_id: job.id,
            attempt: job.attempt,
            missing_fields: [
              ...missing,
              ...(verification === 'valid' ? [] : ['verified_email']),
            ],
            latency_ms: result.result?.latencyMs ?? 0,
            completed_at: new Date().toISOString(),
          });
          if (ready) succeeded += 1;
          else partial += 1;
        } else {
          skipped += 1;
        }
      }
    } catch (error) {
      failed += 1;
      await client
        .from('sales_os_audience_members')
        .update({
          status: 'needs_enrichment',
          updated_by: actor,
        })
        .eq('tenant_id', tenantId)
        .eq('id', member.id);
    }
  }
  return {
    status: 'executed',
    result: { success: true, succeeded, partial, failed, skipped },
  };
}

export async function recalculateAudienceQualityForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
) {
  const { job, actor } = input;
  const audienceId = String(job.input.audienceId ?? '');
  const definitionId = String(job.input.definitionId ?? '');
  if (!audienceId || !definitionId)
    throw new Error('Audience quality jobs require audienceId and definitionId.');
  const [
    { data: audience, error: audienceError },
    { data: members, error: memberError },
  ] = await Promise.all([
    client
      .from('sales_os_audiences')
      .select('id,icp_id,evidence_score,supporting_evidence,status')
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('id', audienceId)
      .single(),
    client
      .from('sales_os_audience_members')
      .select(
        'id,account_id,contact_id,confidence,consent_state,suppression_state,status,freshness_at',
      )
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('audience_id', audienceId)
      .eq('definition_id', definitionId),
  ]);
  if (audienceError) throw audienceError;
  if (memberError) throw memberError;
  const counts = {
    member: 0,
    ready: 0,
    stale: 0,
    missing: 0,
    lowConfidence: 0,
    suppressed: 0,
    blocked: 0,
  };
  const scores: number[] = [];
  const reasons: string[] = [];
  for (const member of members ?? []) {
    const [accountResult, contactResult, duplicateResult] = await Promise.all([
      member.account_id
        ? client
            .from('sales_os_accounts')
            .select(
              'name,domain,website_url,industry,enrichment_status,last_enriched_at',
            )
            .eq('tenant_id', tenantId)
            .eq('id', member.account_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      member.contact_id
        ? client
            .from('sales_os_contacts')
            .select(
              'full_name,title,professional_email,email_verification_status,enrichment_status,last_enriched_at',
            )
            .eq('tenant_id', tenantId)
            .eq('id', member.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client
        .from('sales_os_identity_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('member_id', member.id)
        .eq('status', 'pending'),
    ]);
    if (accountResult.error) throw accountResult.error;
    if (contactResult.error) throw contactResult.error;
    if (duplicateResult.error) throw duplicateResult.error;
    const account = accountResult.data as Record<string, unknown> | null;
    const contact = contactResult.data as Record<string, unknown> | null;
    const accountFields = account ? ['name', 'domain', 'website_url', 'industry'] : [];
    const contactFields = contact ? ['full_name', 'title', 'professional_email'] : [];
    const missingFields = [...accountFields, ...contactFields].filter((field) => {
      const value = account?.[field] ?? contact?.[field];
      return !String(value ?? '').trim();
    });
    if (contact && contact.email_verification_status !== 'valid')
      missingFields.push('verified_email');
    const stale =
      !member.freshness_at ||
      Date.parse(member.freshness_at) < Date.now() - 30 * 86400000;
    const contactVerification = contact?.email_verification_status === 'valid' ? 1 : 0;
    const completenessTotal = Math.max(
      accountFields.length + contactFields.length + 1,
      1,
    );
    const completeness = Math.max(0, 1 - missingFields.length / completenessTotal);
    const suppressionClear = member.suppression_state === 'clear';
    const consentPermitted = !['restricted', 'revoked'].includes(
      String(member.consent_state),
    );
    const duplicateRisk = Number(duplicateResult.count ?? 0) > 0 ? 0.75 : 0;
    const signalFreshness = 1;
    const sourceFreshness = stale ? 0 : 1;
    const score = qualityScoreWorker({
      strategicFit:
        audience.evidence_score === 'high'
          ? 0.9
          : audience.evidence_score === 'medium'
            ? 0.65
            : 0.35,
      evidenceStrength: Math.min(1, (audience.supporting_evidence?.length ?? 0) / 3),
      identityConfidence: Number(member.confidence ?? 0),
      contactVerification,
      signalFreshness,
      sourceFreshness,
      duplicateRisk,
      suppressionClear,
      consentPermitted,
      reachable: contactVerification === 1,
      completeness,
      stale,
      missingFields,
    });
    const { data: currentQuality, error: currentQualityError } = await client
      .from('sales_os_audience_quality_snapshots')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('member_id', member.id)
      .eq('is_current', true)
      .maybeSingle();
    if (currentQualityError) throw currentQualityError;
    if (currentQuality) {
      const { error } = await client
        .from('sales_os_audience_quality_snapshots')
        .update({ is_current: false })
        .eq('tenant_id', tenantId)
        .eq('id', currentQuality.id);
      if (error) throw error;
    }
    const { error: snapshotError } = await client
      .from('sales_os_audience_quality_snapshots')
      .insert({
        tenant_id: tenantId,
        product_id: job.product_id,
        definition_id: definitionId,
        member_id: member.id,
        strategic_fit_score: score.dimensions.strategicFit,
        identity_confidence_score: score.dimensions.identityConfidence,
        contact_verification_score: score.dimensions.contactVerification,
        freshness_score: score.dimensions.sourceFreshness,
        quality_score: score.score,
        readiness_state: score.state,
        reasons: score.reasons,
        calculated_at: new Date().toISOString(),
        calculation_version: 'quality_v1',
        is_current: true,
        created_by: actor,
      });
    if (snapshotError) throw snapshotError;
    const { error: memberUpdateError } = await client
      .from('sales_os_audience_members')
      .update({ status: score.state, updated_by: actor })
      .eq('tenant_id', tenantId)
      .eq('id', member.id);
    if (memberUpdateError) throw memberUpdateError;
    counts.member += 1;
    if (score.state === 'ready') counts.ready += 1;
    if (score.state === 'stale') counts.stale += 1;
    if (score.state === 'needs_enrichment') counts.missing += 1;
    if (score.state === 'low_confidence') counts.lowConfidence += 1;
    if (score.state === 'suppressed') counts.suppressed += 1;
    if (score.state === 'blocked') counts.blocked += 1;
    scores.push(score.score);
    reasons.push(...score.reasons);
  }
  const qualityScore = scores.length
    ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(4))
    : 0;
  const readinessState =
    counts.blocked > 0
      ? 'blocked'
      : counts.suppressed > 0
        ? 'suppressed'
        : counts.stale > 0
          ? 'stale'
          : counts.missing > 0
            ? 'needs_enrichment'
            : counts.lowConfidence > 0
              ? 'low_confidence'
              : 'ready';
  const { error: rollupError } = await client
    .from('sales_os_audience_quality_rollups')
    .upsert(
      {
        tenant_id: tenantId,
        product_id: job.product_id,
        icp_id: audience.icp_id,
        audience_id: audienceId,
        definition_id: definitionId,
        member_count: counts.member,
        ready_count: counts.ready,
        stale_count: counts.stale,
        missing_data_count: counts.missing,
        low_confidence_count: counts.lowConfidence,
        suppressed_count: counts.suppressed,
        blocked_count: counts.blocked,
        quality_score: qualityScore,
        readiness_state: readinessState,
        reasons: [...new Set(reasons)],
        calculated_at: new Date().toISOString(),
        calculation_version: 'quality_v1',
        updated_by: actor,
      },
      { onConflict: 'tenant_id,definition_id' },
    );
  if (rollupError) throw rollupError;
  const { error: audienceUpdateError } = await client
    .from('sales_os_audiences')
    .update({
      quality_state: readinessState,
      quality_score: qualityScore,
      quality_last_calculated_at: new Date().toISOString(),
      quality_calculation_version: 'quality_v1',
      updated_by: actor,
    })
    .eq('tenant_id', tenantId)
    .eq('id', audienceId);
  if (audienceUpdateError) throw audienceUpdateError;
  return {
    status: 'executed',
    result: { success: true, ...counts, qualityScore, readinessState },
  };
}

export async function scoreAudienceIntentForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
) {
  const { job, actor } = input;
  const audienceId = String(job.input.audienceId ?? '');
  const definitionId = String(job.input.definitionId ?? '');
  if (!audienceId || !definitionId)
    throw new Error('Audience intent jobs require audienceId and definitionId.');

  const [
    { data: audience, error: audienceError },
    { data: profile, error: profileError },
    { data: signals, error: signalError },
    { data: members, error: memberError },
    { count: priorEngagements, error: engagementError },
  ] = await Promise.all([
    client
      .from('sales_os_audiences')
      .select(
        'id,icp_id,name,problem_use_case_fit,purchase_triggers,relevant_terminology',
      )
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('id', audienceId)
      .single(),
    client
      .from('sales_os_product_profiles')
      .select(
        'description,problems_solved,core_capabilities,primary_use_cases,purchase_triggers,positioning_value_props',
      )
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('sales_os_signals')
      .select(
        'id,name,description,signal_type,normalized_signal_type,signal_direction,base_weight,weight,specificity,updated_at',
      )
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('audience_id', audienceId)
      .eq('status', 'active'),
    client
      .from('sales_os_audience_members')
      .select('id,confidence,status,suppression_state,consent_state')
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('audience_id', audienceId)
      .eq('definition_id', definitionId)
      .not('status', 'in', '(suppressed,blocked)'),
    client
      .from('sales_os_engagements')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('audience_id', audienceId),
  ]);
  if (audienceError) throw audienceError;
  if (profileError) throw profileError;
  if (signalError) throw signalError;
  if (memberError) throw memberError;
  if (engagementError) throw engagementError;
  if (!audience.icp_id) throw new Error('Audience intent requires a linked ICP.');

  const { data: icp, error: icpError } = await client
    .from('sales_os_icps')
    .select('name,summary,core_problem,why_product_fits,purchase_trigger')
    .eq('tenant_id', tenantId)
    .eq('id', audience.icp_id)
    .single();
  if (icpError) throw icpError;

  const productText = joinText(profile, [
    'description',
    'problems_solved',
    'core_capabilities',
    'primary_use_cases',
    'purchase_triggers',
    'positioning_value_props',
  ]);
  const icpText = joinText(icp, [
    'name',
    'summary',
    'core_problem',
    'why_product_fits',
    'purchase_trigger',
  ]);
  const audienceText = joinText(audience, [
    'name',
    'problem_use_case_fit',
    'purchase_triggers',
    'relevant_terminology',
  ]);
  const signalFrequency = new Map<string, number>();
  for (const signal of signals ?? []) {
    const type = signal.normalized_signal_type ?? signal.signal_type;
    signalFrequency.set(type, (signalFrequency.get(type) ?? 0) + 1);
  }
  let scored = 0;
  for (const signal of signals ?? []) {
    const signalText = [signal.name, signal.description]
      .filter(Boolean)
      .join(': ')
      .trim();
    const result = calculateIntentScoreWorker({
      productText,
      icpText,
      audienceText,
      signalType: signal.normalized_signal_type ?? signal.signal_type,
      signalText,
      direction: signal.signal_direction ?? 'positive',
      baseWeight: Math.min(
        1,
        Number(signal.base_weight ?? signal.weight ?? 0.5) *
          Math.max(0, Number(signal.specificity ?? 0.5)),
      ),
      observedAt: signal.updated_at,
      frequency:
        signalFrequency.get(signal.normalized_signal_type ?? signal.signal_type) ?? 1,
      priorEngagements: Number(priorEngagements ?? 0),
      now: Date.now(),
    });
    for (const member of members ?? []) {
      const confidence = Math.max(0, Math.min(1, Number(member.confidence ?? 0)));
      const memberScore = Number((result.score * (0.7 + confidence * 0.3)).toFixed(4));
      const { data: scoreRow, error: scoreError } = await client
        .from('sales_os_intent_scores')
        .insert({
          tenant_id: tenantId,
          product_id: job.product_id,
          icp_id: audience.icp_id,
          audience_id: audienceId,
          member_id: member.id,
          signal_id: signal.id,
          score: memberScore,
          raw_score: result.score,
          confidence,
          signal_type: signal.normalized_signal_type ?? signal.signal_type,
          explanation: `${result.state}: ${signalText || 'No signal text available.'}`,
          score_explanation: { ...result.explanation, memberConfidence: confidence },
          evidence: [{ signalId: signal.id, signalText }],
          score_version: 'intent_v1',
          calculation_version: 'intent_v1',
          source_observation_count: 1,
          scored_at: new Date().toISOString(),
          created_by: actor,
        })
        .select('id')
        .single();
      if (scoreError) throw scoreError;
      const { error: eventError } = await client.from('sales_os_events').insert({
        tenant_id: tenantId,
        product_id: job.product_id,
        event_type: 'intent_scored',
        audience_id: audienceId,
        signal_id: signal.id,
        dimensions: {
          audienceId,
          memberId: member.id,
          signalId: signal.id,
          signalType: signal.normalized_signal_type ?? signal.signal_type,
          score: memberScore,
          state: result.state,
          calculationVersion: 'intent_v1',
        },
        occurred_at: new Date().toISOString(),
        idempotency_key: `intent-scored:${scoreRow.id}`,
        created_by: actor,
      });
      if (eventError) throw eventError;
      scored += 1;
    }
  }
  return { status: 'executed', result: { success: true, scored } };
}

function joinText(value: Record<string, unknown> | null, fields: string[]) {
  return fields
    .flatMap((field) => {
      const item = value?.[field];
      return Array.isArray(item) ? item : [item];
    })
    .filter((item) => item !== null && item !== undefined)
    .map((item) => String(item))
    .join(' ');
}

function calculateIntentScoreWorker(input: {
  productText: string;
  icpText: string;
  audienceText: string;
  signalType: string;
  signalText: string;
  direction: 'positive' | 'negative' | 'neutral';
  baseWeight: number;
  observedAt: string | null;
  frequency: number;
  priorEngagements: number;
  now: number;
}) {
  const recencyDays = input.observedAt
    ? Math.max(0, (input.now - Date.parse(input.observedAt)) / 86_400_000)
    : null;
  const recencyDecay = recencyDays === null ? 0.5 : Math.max(0, 1 - recencyDays / 90);
  const productFit = textOverlap(input.signalText, input.productText);
  const icpFit = textOverlap(input.signalText, input.icpText);
  const audienceFit = textOverlap(input.signalText, input.audienceText);
  const frequencyBoost = Math.min(0.25, Math.max(0, input.frequency - 1) * 0.05);
  const priorEngagementBoost = Math.min(
    0.15,
    Math.max(0, input.priorEngagements) * 0.03,
  );
  const penalty = input.direction === 'negative' ? 0.45 : 0;
  const raw =
    input.baseWeight * 0.3 +
    productFit * 0.2 +
    icpFit * 0.2 +
    audienceFit * 0.1 +
    recencyDecay * 0.15 +
    frequencyBoost +
    priorEngagementBoost -
    penalty;
  const score = Math.max(0, Math.min(1, Number(raw.toFixed(4))));
  const state = !input.signalText.trim()
    ? 'insufficient_evidence'
    : input.direction === 'negative'
      ? 'negative'
      : score >= 0.75
        ? 'high'
        : score >= 0.45
          ? 'medium'
          : 'low';
  return {
    score,
    state,
    explanation: {
      calculationVersion: 'intent_v1',
      normalizedSignalType: input.signalType,
      direction: input.direction,
      baseWeight: input.baseWeight,
      productFit,
      icpFit,
      audienceFit,
      recencyDays,
      recencyDecay,
      frequency: input.frequency,
      frequencyBoost,
      priorEngagements: input.priorEngagements,
      priorEngagementBoost,
      negativePenalty: penalty,
      evidencePresent: Boolean(input.signalText.trim()),
    },
  };
}

function textOverlap(left: string, right: string) {
  const a = new Set(
    left
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 2),
  );
  const b = new Set(
    right
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 2),
  );
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / a.size;
}

function qualityScoreWorker(input: {
  strategicFit: number;
  evidenceStrength: number;
  identityConfidence: number;
  contactVerification: number;
  signalFreshness: number;
  sourceFreshness: number;
  duplicateRisk: number;
  suppressionClear: boolean;
  consentPermitted: boolean;
  reachable: boolean;
  completeness: number;
  stale: boolean;
  missingFields: string[];
}) {
  const score = Number(
    (
      input.strategicFit * 0.12 +
      input.evidenceStrength * 0.12 +
      input.identityConfidence * 0.12 +
      input.contactVerification * 0.14 +
      input.signalFreshness * 0.06 +
      input.sourceFreshness * 0.08 +
      (1 - input.duplicateRisk) * 0.08 +
      (input.suppressionClear ? 1 : 0) * 0.1 +
      (input.consentPermitted ? 1 : 0) * 0.08 +
      (input.reachable ? 1 : 0) * 0.04 +
      input.completeness * 0.06
    ).toFixed(4),
  );
  const reasons = [
    ...(!input.suppressionClear ? ['suppressed'] : []),
    ...(!input.consentPermitted ? ['consent is restricted or revoked'] : []),
    ...(input.stale ? ['source or enrichment data is stale'] : []),
    ...(input.missingFields.length
      ? [`missing: ${input.missingFields.join(', ')}`]
      : []),
    ...(input.duplicateRisk >= 0.65 ? ['duplicate risk requires review'] : []),
    ...(!input.reachable ? ['no verified reachable contact'] : []),
  ];
  const state = !input.consentPermitted
    ? 'blocked'
    : !input.suppressionClear
      ? 'suppressed'
      : input.stale
        ? 'stale'
        : input.missingFields.length || input.completeness < 0.8
          ? 'needs_enrichment'
          : input.identityConfidence < 0.65 || score < 0.6
            ? 'low_confidence'
            : 'ready';
  return {
    score,
    state,
    reasons,
    dimensions: {
      strategicFit: input.strategicFit,
      evidenceStrength: input.evidenceStrength,
      identityConfidence: input.identityConfidence,
      contactVerification: input.contactVerification,
      sourceFreshness: input.sourceFreshness,
    },
  };
}

function directCandidates(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value))
    return value.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object'),
    );
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

type WorkerSocialCandidate = {
  canonicalUrl: string;
  title: string;
  excerpt: string;
  sourceType: 'reddit' | 'forum' | 'blog' | 'web' | 'other';
  sourceName: string;
  externalId?: string;
  publishedAt?: string | null;
  signalType: string;
  signalSpecificity: number;
  metadata: Record<string, unknown>;
  dedupeKey: string;
};

function normalizeCommunityResults(
  value: unknown,
  productId: string,
): WorkerSocialCandidate[] {
  const root =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const children = Array.isArray(root.children)
    ? root.children
        .map((child) =>
          child && typeof child === 'object'
            ? (child as Record<string, unknown>).data
            : null,
        )
        .filter(Boolean)
    : [];
  const rows = Array.isArray(value) ? value : children;
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    const permalink = String(item.permalink ?? item.url ?? '').trim();
    if (!permalink) return [];
    const canonicalUrl = permalink.startsWith('http')
      ? permalink.split('#')[0].replace(/\/$/, '')
      : `https://www.reddit.com${permalink}`;
    const excerpt = String(item.selftext ?? item.text ?? item.title ?? '').trim();
    const title = String(item.title ?? 'Community discussion').trim();
    if (!excerpt || !title) return [];
    const lower = `${title} ${excerpt}`.toLowerCase();
    const signalType = /\b(price|cost|budget|expensive|afford)\b/.test(lower)
      ? 'pricing_signal'
      : /\b(need|looking for|recommend|recommendation|how do i|where can i)\b/.test(
            lower,
          )
        ? 'request_for_solution'
        : /\b(frustrat|problem|broken|hate|complain|difficult|struggle)\b/.test(lower)
          ? 'pain_complaint'
          : 'relevant_discussion';
    const publishedAt =
      typeof item.created_utc === 'number'
        ? new Date(item.created_utc * 1000).toISOString()
        : typeof item.publishedAt === 'string'
          ? item.publishedAt
          : null;
    return [
      {
        canonicalUrl,
        title,
        excerpt,
        sourceType: canonicalUrl.includes('reddit.com') ? 'reddit' : 'forum',
        sourceName: String(
          item.subreddit_name_prefixed ?? item.subreddit ?? 'Public community',
        ),
        externalId: typeof item.id === 'string' ? item.id : undefined,
        publishedAt,
        signalType,
        signalSpecificity: signalType === 'relevant_discussion' ? 0.55 : 0.9,
        metadata: { author: item.author ?? null, permalink: canonicalUrl },
        dedupeKey: `${tenantId}:${productId}:social:${String(item.id ?? canonicalUrl)}`,
      },
    ];
  });
}

function scoreWorkerEvidence(
  evidenceCount: number,
  sourceDiversity: number,
  signalSpecificity: number,
  recencyDays: number | null,
) {
  const normalized = {
    evidenceCount: Math.min(1, evidenceCount / 4),
    sourceDiversity: Math.min(1, sourceDiversity / 3),
    signalSpecificity: Math.min(1, Math.max(0, signalSpecificity)),
    recency: recencyDays === null ? 0 : Math.min(1, Math.max(0, 1 - recencyDays / 90)),
  };
  const weightedTotal =
    normalized.evidenceCount * 0.25 +
    normalized.sourceDiversity * 0.25 +
    normalized.signalSpecificity * 0.25 +
    normalized.recency * 0.25;
  const score =
    weightedTotal >= 0.75 ? 'high' : weightedTotal >= 0.45 ? 'medium' : 'low';
  return {
    score,
    detail: {
      evidenceCount,
      sourceDiversity,
      signalSpecificity,
      recencyDays,
      rubricVersion: 'evidence_v1',
      normalized,
      weightedTotal,
      score,
    },
  };
}

async function ensureSocialSignal(
  client: SupabaseClient,
  input: {
    productId: string;
    audienceId: string;
    candidate: WorkerSocialCandidate;
    activeSignals: Array<Record<string, unknown>>;
    actor: string;
  },
) {
  const existing = input.activeSignals.find(
    (signal) => String(signal.signal_type) === input.candidate.signalType,
  );
  if (existing?.id) return { id: existing.id };
  const { data: persisted, error: persistedError } = await client
    .from('sales_os_signals')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('audience_id', input.audienceId)
    .eq('signal_type', input.candidate.signalType)
    .eq('status', 'active')
    .maybeSingle();
  if (persistedError) throw persistedError;
  if (persisted?.id) return { id: persisted.id };
  const { data, error } = await client
    .from('sales_os_signals')
    .insert({
      tenant_id: tenantId,
      product_id: input.productId,
      audience_id: input.audienceId,
      name: input.candidate.signalType.replaceAll('_', ' '),
      description: `Detected public-community ${input.candidate.signalType}.`,
      signal_type: input.candidate.signalType,
      specificity: input.candidate.signalSpecificity,
      status: 'active',
      origin: 'initial_analysis',
      created_by: input.actor,
      updated_by: input.actor,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

function recommendedSocialAction(signalType: string): string {
  if (signalType === 'request_for_solution')
    return 'Respond with a useful answer and relevant next step.';
  if (signalType === 'pain_complaint')
    return 'Acknowledge the pain and offer a contextual solution.';
  if (signalType === 'pricing_signal')
    return 'Address the commercial concern transparently.';
  return 'Review the discussion for a genuinely helpful contribution.';
}

function directEvidence(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object'),
      )
    : [];
}

function normalizeDirectDomain(value: string): string | null {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return null;
  }
}

type DraftExecution = ({status:'paused_budget';result:null}|{status:'executed'|'failed';result:CapabilityResult}) & {engagementId?:string|null;engagementIds?:string[];alreadyExists?:boolean};

export async function generateEngagementForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
): Promise<DraftExecution> {
  const { job, actor } = input;
  const outreachDecisionId = String(job.input.outreachDecisionId ?? '');
  if (outreachDecisionId) {
    return generateEngagementFromDecision(client, { job, actor, outreachDecisionId });
  }
  const opportunityId = String(job.input.opportunityId ?? '');
  if (!opportunityId) throw new Error('Engagement jobs require an opportunityId.');
  const sourceDecisionId = String(job.input.sourceDecisionId ?? '');
  const { data: opportunity, error: opportunityError } = await client
    .from('sales_os_opportunities')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('id', opportunityId)
    .single();
  if (opportunityError) throw opportunityError;
  if (opportunity.status === 'awaiting_review') {
    const { error: approvalError } = await client
      .from('sales_os_opportunities')
      .update({
        status: 'approved',
        updated_by: actor,
        state_changed_by: actor,
      })
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('id', opportunity.id)
      .eq('status', 'awaiting_review');
    if (approvalError) throw approvalError;
  } else if (!['approved', 'engagement_pending'].includes(opportunity.status))
    throw new Error('Engagement drafting requires an approved opportunity.');
  const { data: audience, error: audienceError } = await client
    .from('sales_os_audiences')
    .select('id,name,buyer_type,outreach_motion,collateral_strategy,status,icp_id')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('id', opportunity.audience_id)
    .single();
  if (audienceError) throw audienceError;
  const { data: contact, error: contactError } = opportunity.contact_id
    ? await client
        .from('sales_os_contacts')
        .select(
          'full_name,title,professional_email,email_verification_status,source_evidence',
        )
        .eq('tenant_id', tenantId)
        .eq('product_id', job.product_id)
        .eq('id', opportunity.contact_id)
        .maybeSingle()
    : { data: null, error: null };
  if (contactError) throw contactError;
  const { data: profile, error: profileError } = await client
    .from('sales_os_product_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('is_active', true)
    .eq('review_status', 'approved')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile)
    throw new Error('Engagement drafting requires an active product profile.');
  const { data: product, error: productError } = await client
    .from('sales_os_products')
    .select('name,description_input,additional_context')
    .eq('tenant_id', tenantId)
    .eq('id', job.product_id)
    .single();
  if (productError) throw productError;
  const motion =
    normalizeMotion(audience.outreach_motion) ??
    (audience.buyer_type === 'organization' ? 'b2b' : 'b2c');
  const channel =
    opportunity.route_type === 'direct'
      ? 'email'
      : motion === 'community' || motion === 'b2c'
        ? 'reddit'
        : 'professional_social';
  const { data: approvedLearnings, error: learningError } = await client
    .from('sales_os_learnings')
    .select('observation,recommended_change,target_phase')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('status', 'active');
  if (learningError) throw learningError;
  const result = await executeWithBudget(
    client,
    'reasoning',
    {
      task: 'generate_engagement_draft',
      productProfile: profile,
      audience,
      contact,
      opportunityEvidence: opportunity,
      channelStrategy: audience.collateral_strategy ?? {},
      copyGrounding: buildCopyGrounding(product, profile, audience, contact, channel),
      approvedLearnings: approvedLearnings ?? [],
      constraints: {
        requireHumanApproval: true,
        format: 'JSON only',
        draftContentRule:
          'draftContent must contain exactly one message for the requested channel and copy type. Do not include versions for other channels, section headings, labels such as For Reddit:, or surrounding quotation marks. This is first-touch outreach: introduce the product by name, describe capabilities as features of that product, and never imply the recipient already uses or has access to an internal feature. Do not write your [feature], you use [feature], or you have [feature] unless verified recipient evidence explicitly supports it.',
      },
    },
    {
      productId: job.product_id,
      jobId: job.id,
      actor,
      estimatedCost: Number(job.estimated_cost ?? 0),
    },
    `engagement-draft:${opportunityId}`,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  const draft = result.result.data as Record<string, unknown>;
  const messageAngle = String(draft.messageAngle ?? '').trim();
  const cta = String(draft.cta ?? '').trim();
  const draftContent = String(draft.draftContent ?? '').trim();
  if (!messageAngle || !cta || !draftContent)
    throw new Error('AI returned an invalid engagement draft.');
  assertRecipientSafeDraft(draftContent, String(product.name), profile, channel);
  const evidenceContext = Array.isArray(opportunity.evidence)
    ? opportunity.evidence
    : [];
  const objective = String(
    draft.objective ??
      opportunity.recommended_action ??
      'Respond to the qualified opportunity.',
  ).trim();
  const whyEngage = String(
    draft.whyEngage ??
      opportunity.ai_fit_assessment ??
      'Qualified opportunity with supporting evidence.',
  ).trim();
  const followUpStrategy =
    draft.followUpStrategy && typeof draft.followUpStrategy === 'object'
      ? draft.followUpStrategy
      : { cadence: 'human_review_required', steps: [] };
  const riskSensitivity = String(
    draft.riskSensitivity ?? 'Review for relevance and platform compliance.',
  );
  const previousInteraction =
    draft.previousInteraction && typeof draft.previousInteraction === 'object'
      ? draft.previousInteraction
      : {};
  const suppressionCheck = { checked: true, result: 'passed', channel };
  const actionType = channel === 'email' ? 'send' : 'respond';
  const { data: existing } = await client
    .from('sales_os_engagements')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('opportunity_id', opportunityId)
    .in('status', ['drafted', 'awaiting_approval', 'approved', 'queued', 'executed'])
    .limit(1)
    .maybeSingle();
  if (existing) return { ...result, engagementId: existing.id, alreadyExists: true };
  const { data: engagement, error: engagementError } = await client
    .from('sales_os_engagements')
    .insert({
      tenant_id: tenantId,
      product_id: job.product_id,
      opportunity_id: opportunityId,
      outreach_decision_id: sourceDecisionId || null,
      icp_id: audience.icp_id ?? null,
      audience_id: audience.id,
      product_profile_id: profile.id,
      copy_version: 1,
      contact_id: opportunity.contact_id ?? null,
      channel,
      copy_type: copyTypeForChannel(channel),
      action_type: actionType,
      objective,
      subject: channel === 'email' ? String(draft.subject ?? '') || null : null,
      evidence_context: evidenceContext,
      why_engage: whyEngage,
      follow_up_strategy: followUpStrategy,
      risk_sensitivity: riskSensitivity,
      previous_interaction: previousInteraction,
      suppression_check: suppressionCheck,
      message_angle: messageAngle,
      cta,
      draft_content: draftContent,
      status: 'awaiting_approval',
      created_by: actor,
      updated_by: actor,
      state_changed_by: actor,
    })
    .select()
    .single();
  if (engagementError) throw engagementError;
  const { error: approvalError } = await client.from('sales_os_approvals').insert({
    tenant_id: tenantId,
    product_id: job.product_id,
    entity_type: 'engagement',
    entity_id: engagement.id,
    action_type: channel === 'email' ? 'send_email' : 'community_response',
    proposed_payload: {
      draftContent,
      messageAngle,
      cta,
      opportunityId,
      contactId: opportunity.contact_id ?? null,
    },
    status: 'pending',
    requested_by: actor,
    created_by: actor,
    updated_by: actor,
    state_changed_by: actor,
  });
  if (approvalError) throw approvalError;
  return { ...result, engagementId: engagement.id };
}

async function generateEngagementFromDecision(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string; outreachDecisionId: string },
) {
  const { job, actor, outreachDecisionId } = input;
  const { data: decision, error: decisionError } = await client
    .from('sales_os_outreach_decisions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('id', outreachDecisionId)
    .single();
  if (decisionError) throw decisionError;
  if (decision.status !== 'approved')
    throw new Error('Copy drafting requires an approved outreach decision.');

  const { data: audience, error: audienceError } = await client
    .from('sales_os_audiences')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('id', decision.audience_id)
    .single();
  if (audienceError) throw audienceError;

  if (decision.channel === 'email' && (audience.buyer_type === 'organization' || ['b2b','b2b2c'].includes(audience.outreach_motion))) {
    const { data: opportunities, error: opportunitiesError } = await client
      .from('sales_os_opportunities')
      .select('id,contact_id')
      .eq('tenant_id', tenantId)
      .eq('product_id', job.product_id)
      .eq('audience_id', decision.audience_id)
      .eq('route_type', 'direct')
      .not('contact_id', 'is', null)
      .in('status', ['awaiting_review', 'approved', 'engagement_pending']);
    if (opportunitiesError) throw opportunitiesError;

    const engagementIds: string[] = [];
    for (const opportunity of opportunities ?? []) {
      const recipientResult = await generateEngagementForWorker(client, {
        job: {
          ...job,
          input: {
            opportunityId: opportunity.id,
            sourceDecisionId: decision.id,
          },
        },
        actor,
      });
      if (recipientResult.status !== 'executed' || !recipientResult.result.success)
        return recipientResult;
      if (recipientResult.engagementId)
        engagementIds.push(recipientResult.engagementId);
    }

    return {
      status: 'executed' as const,
      result: {
        provider: 'recipient-specific-drafts',
        success: engagementIds.length > 0,
        error: engagementIds.length === 0 ? {code:'recipients_unavailable',message:'No eligible recipient drafts were created. Find and verify contacts for this audience first.',retryable:true} : undefined,
        data: {
          engagementIds,
          recipientCount: opportunities?.length ?? 0,
          waitingForRecipients: (opportunities?.length ?? 0) === 0,
        },
        cost: 0,
        latencyMs: 0,
      },
      engagementId: engagementIds[0] ?? null,
      engagementIds,
    };
  }
  const { data: profile, error: profileError } = await client
    .from('sales_os_product_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('is_active', true)
    .eq('review_status', 'approved')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error('Copy drafting requires an active product profile.');
  const { data: product, error: productError } = await client
    .from('sales_os_products')
    .select('name,description_input,additional_context')
    .eq('tenant_id', tenantId)
    .eq('id', job.product_id)
    .single();
  if (productError) throw productError;
  const channel = decision.channel;
  const { data: approvedLearnings, error: learningError } = await client
    .from('sales_os_learnings')
    .select('observation,recommended_change,target_phase')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('status', 'active');
  if (learningError) throw learningError;

  const result = await executeWithBudget(
    client,
    'reasoning',
    {
      task: 'generate_engagement_draft',
      productProfile: profile,
      audience,
      outreachDecision: decision,
      contact: null,
      opportunityEvidence: null,
      channelStrategy: decision.strategy ?? {},
      copyGrounding: buildCopyGrounding(product, profile, audience, null, channel),
      approvedLearnings: approvedLearnings ?? [],
      constraints: {
        requireHumanApproval: true,
        format: 'JSON only',
        draftContentRule:
          'draftContent must contain exactly one message for the requested channel and copy type. Do not include versions for other channels, section headings, labels such as For Reddit:, or surrounding quotation marks. This is first-touch outreach: introduce the product by name, describe capabilities as features of that product, and never imply the recipient already uses or has access to an internal feature. Do not write your [feature], you use [feature], or you have [feature] unless verified recipient evidence explicitly supports it.',
      },
    },
    {
      productId: job.product_id,
      jobId: job.id,
      actor,
      estimatedCost: Number(job.estimated_cost ?? 0),
    },
    `engagement-draft:decision:${outreachDecisionId}:v${decision.version}`,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  const draft = result.result.data as Record<string, unknown>;
  const messageAngle = String(draft.messageAngle ?? '').trim();
  const cta = String(draft.cta ?? decision.cta ?? '').trim();
  const draftContent = String(draft.draftContent ?? '').trim();
  if (!messageAngle || !cta || !draftContent)
    throw new Error('AI returned an invalid engagement draft.');
  assertRecipientSafeDraft(draftContent, String(product.name), profile, channel);

  const { data: existing } = await client
    .from('sales_os_engagements')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .eq('outreach_decision_id', outreachDecisionId)
    .eq('copy_version', decision.version)
    .in('status', ['drafted', 'awaiting_approval', 'approved', 'queued', 'executed'])
    .limit(1)
    .maybeSingle();
  if (existing) return { ...result, engagementId: existing.id, alreadyExists: true };

  const { data: engagement, error: engagementError } = await client
    .from('sales_os_engagements')
    .insert({
      tenant_id: tenantId,
      product_id: job.product_id,
      opportunity_id: null,
      outreach_decision_id: decision.id,
      icp_id: decision.icp_id,
      audience_id: decision.audience_id,
      product_profile_id: profile.id,
      copy_version: decision.version,
      contact_id: null,
      channel,
      copy_type: copyTypeForChannel(channel),
      action_type: channel === 'email' ? 'send' : 'respond',
      objective: decision.objective,
      subject: channel === 'email' ? String(draft.subject ?? '') || null : null,
      evidence_context: audience.supporting_evidence ?? [],
      why_engage: decision.rationale,
      follow_up_strategy: draft.followUpStrategy ?? {
        cadence: 'human_review_required',
        steps: [],
      },
      risk_sensitivity: String(
        draft.riskSensitivity ?? 'Review for relevance and platform compliance.',
      ),
      previous_interaction: {},
      suppression_check: {
        checked: false,
        result: 'not_applicable_until_recipient_selected',
        channel,
      },
      message_angle: messageAngle,
      cta,
      draft_content: draftContent,
      status: 'awaiting_approval',
      created_by: actor,
      updated_by: actor,
      state_changed_by: actor,
    })
    .select()
    .single();
  if (engagementError) throw engagementError;
  const { error: approvalError } = await client.from('sales_os_approvals').insert({
    tenant_id: tenantId,
    product_id: job.product_id,
    entity_type: 'engagement',
    entity_id: engagement.id,
    action_type: channel === 'email' ? 'send_email' : 'community_response',
    proposed_payload: { draftContent, messageAngle, cta, outreachDecisionId },
    status: 'pending',
    requested_by: actor,
    created_by: actor,
    updated_by: actor,
    state_changed_by: actor,
  });
  if (approvalError) throw approvalError;
  await recordWorkflowLineage(client, {
    productId: job.product_id,
    relationType: 'outreach_decision_to_copy',
    outreachDecisionId: decision.id,
    engagementId: engagement.id,
    actor,
  });
  return { ...result, engagementId: engagement.id };
}

export async function analyzeLearningForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
) {
  const { job, actor } = input;
  const { data: events, error } = await client
    .from('sales_os_events')
    .select(
      'event_type,occurred_at,audience_id,opportunity_id,engagement_id,source_id,signal_id,provider_id,contact_role,message_angle,cta,follow_up_cadence,dimensions',
    )
    .eq('tenant_id', tenantId)
    .eq('product_id', job.product_id)
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  const sampleSize = events?.length ?? 0;
  const minimumSampleSize = Number(job.input.minimumSampleSize ?? 10);
  if (sampleSize < minimumSampleSize)
    return { status: 'insufficient_sample' as const, sampleSize };
  const result = await executeWithBudget(
    client,
    'reasoning',
    {
      task: 'learning_analysis',
      productId: job.product_id,
      metrics: {
        sampleSize,
        byEventType: countEventTypes(events ?? []),
        breakdowns: aggregateWorkerLearningMetrics(events ?? []),
      },
      minimumSampleSize,
      constraints: { proposeOnly: true, format: 'JSON only' },
    },
    {
      productId: job.product_id,
      jobId: job.id,
      actor,
      estimatedCost: Number(job.estimated_cost ?? 0),
    },
    `learning-analysis:${job.product_id}`,
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  const recommendation = result.result.data as Record<string, unknown>;
  const recommendedChange = recommendation.recommendedChange as
    Record<string, unknown> | undefined;
  if (!recommendation.observation || !recommendedChange?.targetKey)
    throw new Error('AI returned an invalid learning recommendation.');
  const { data: learning, error: learningError } = await client
    .from('sales_os_learnings')
    .insert({
      tenant_id: tenantId,
      product_id: job.product_id,
      observation: String(recommendation.observation),
      supporting_evidence: recommendation.supportingEvidence ?? [],
      sample_size: sampleSize,
      confidence: ['low', 'high'].includes(String(recommendation.confidence))
        ? recommendation.confidence
        : 'medium',
      recommended_change: recommendedChange,
      target_phase: [
        'product_audience',
        'route_find',
        'engage',
        'provider_layer',
      ].includes(String(recommendation.targetPhase))
        ? recommendation.targetPhase
        : 'product_audience',
      target_entity_type: String(recommendedChange.targetKey),
      target_entity_id: recommendedChange.targetEntityId ?? null,
      status: 'proposed',
      created_by: actor,
      updated_by: actor,
      state_changed_by: actor,
    })
    .select()
    .single();
  if (learningError) throw learningError;
  return { ...result, learningId: learning.id };
}

function aggregateWorkerLearningMetrics(events: Array<Record<string, unknown>>) {
  const keys = [
    'audience',
    'route',
    'source',
    'signal',
    'contactRole',
    'messageAngle',
    'cta',
    'followUpCadence',
    'provider',
  ];
  const result = Object.fromEntries(
    keys.map((key) => [key, {} as Record<string, number>]),
  );
  for (const event of events) {
    const dimensions = (event.dimensions ?? {}) as Record<string, unknown>;
    const values: Record<string, unknown> = {
      audience: event.audience_id,
      route: dimensions.route ?? dimensions.routeType,
      source: event.source_id ?? dimensions.source ?? dimensions.sourceType,
      signal: event.signal_id ?? dimensions.signal,
      contactRole:
        event.contact_role ?? dimensions.contactRole ?? dimensions.contact_role,
      messageAngle:
        event.message_angle ?? dimensions.messageAngle ?? dimensions.message_angle,
      cta: event.cta ?? dimensions.cta,
      followUpCadence:
        event.follow_up_cadence ??
        dimensions.followUpCadence ??
        dimensions.follow_up_cadence,
      provider: event.provider_id ?? dimensions.provider,
    };
    for (const key of keys) {
      if (values[key] == null || String(values[key]).trim() === '') continue;
      const bucket = String(values[key]);
      result[key][bucket] = (result[key][bucket] ?? 0) + 1;
    }
  }
  return result;
}

export async function executeEngagementForWorker(
  _client: SupabaseClient,
  _input: { job: WorkerJobInput; actor: string },
): Promise<never> {
  throw new Error(
    'Engagement execution is disabled. Copy approval does not send or publish.',
  );
}

type ActivationDestination = {
  id: string;
  destination_type: 'csv' | 'webhook' | 'crm';
  connector_key: string;
  endpoint_url: string | null;
  secret_ref: string | null;
};

function evaluateAudienceRule(
  rule: Record<string, unknown>,
  entity: Record<string, unknown>,
) {
  const conditions = (rule.conditions ?? rule.filters ?? {}) as Record<string, unknown>;
  const evaluate = (condition: unknown): boolean => {
    if (!condition || typeof condition !== 'object') return true;
    if (Array.isArray(condition)) return condition.every(evaluate);
    const item = condition as Record<string, unknown>;
    const actual = item.field ? entity[String(item.field)] : undefined;
    const expected = item.value;
    switch (String(item.operator ?? 'exists')) {
      case 'exists':
        return actual !== null && actual !== undefined && String(actual).trim() !== '';
      case 'equals':
        return (
          String(actual ?? '').toLowerCase() === String(expected ?? '').toLowerCase()
        );
      case 'contains':
        return String(actual ?? '')
          .toLowerCase()
          .includes(String(expected ?? '').toLowerCase());
      case 'in':
        return Array.isArray(expected) && expected.map(String).includes(String(actual));
      default:
        return false;
    }
  };
  const all = conditions.all ?? rule.all ?? [];
  const any = conditions.any ?? rule.any;
  const exclude = conditions.exclude ?? rule.exclude ?? [];
  const excluded = Array.isArray(exclude) ? exclude.some(evaluate) : evaluate(exclude);
  return (
    evaluate(all) &&
    (any === undefined || (Array.isArray(any) && any.some(evaluate))) &&
    !excluded
  );
}

export async function executeAudienceRefreshForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
) {
  const { job, actor } = input;
  const definitionId = String(job.input.definitionId ?? '');
  if (!definitionId) throw new Error('Audience refresh jobs require definitionId.');
  const { data: definition, error: definitionError } = await client
    .from('sales_os_audience_definitions')
    .select('id,product_id,icp_id,audience_id,version,rule_definition,status')
    .eq('tenant_id', tenantId)
    .eq('id', definitionId)
    .single();
  if (definitionError) throw definitionError;
  if (!['approved', 'active'].includes(definition.status))
    throw new Error('Only approved or active definitions can be refreshed.');
  const { data: run, error: runError } = await client
    .from('sales_os_audience_refresh_runs')
    .insert({
      tenant_id: tenantId,
      product_id: definition.product_id,
      icp_id: definition.icp_id,
      audience_id: definition.audience_id,
      definition_id: definition.id,
      status: 'running',
      started_at: new Date().toISOString(),
      created_by: actor,
      updated_by: actor,
    })
    .select('id')
    .single();
  if (runError) throw runError;
  const { data: members, error: memberError } = await client
    .from('sales_os_audience_members')
    .select(
      'id,status,suppression_state,consent_state,identity_type,external_entity_key,account_id,contact_id,source_record_id',
    )
    .eq('tenant_id', tenantId)
    .eq('definition_id', definition.id);
  if (memberError) throw memberError;
  let added = 0,
    removed = 0,
    retained = 0;
  const errors: Array<Record<string, unknown>> = [];
  for (const member of members ?? []) {
    const matches = evaluateAudienceRule(
      (definition.rule_definition ?? {}) as Record<string, unknown>,
      member as Record<string, unknown>,
    );
    const shouldBeActive =
      matches &&
      member.suppression_state !== 'suppressed' &&
      member.consent_state !== 'revoked';
    const nextStatus = shouldBeActive
      ? member.status === 'removed'
        ? 'discovered'
        : member.status
      : 'removed';
    const changeType =
      nextStatus === 'removed' && member.status !== 'removed'
        ? 'removed'
        : member.status === 'removed' && nextStatus !== 'removed'
          ? 'added'
          : 'retained';
    if (changeType === 'added') added += 1;
    else if (changeType === 'removed') removed += 1;
    else retained += 1;
    const { error: updateError } = await client
      .from('sales_os_audience_members')
      .update({ status: nextStatus, updated_by: actor })
      .eq('tenant_id', tenantId)
      .eq('id', member.id);
    if (updateError) {
      errors.push({ memberId: member.id, error: updateError.message });
      continue;
    }
    await client.from('sales_os_audience_membership_changes').insert({
      tenant_id: tenantId,
      product_id: definition.product_id,
      audience_id: definition.audience_id,
      definition_id: definition.id,
      refresh_run_id: run.id,
      member_id: member.id,
      change_type: changeType,
      reason: matches
        ? 'Rule matched; readiness/suppression state preserved.'
        : 'Member no longer matches the versioned rule.',
      evidence: { matches, priorStatus: member.status },
      created_by: actor,
    });
  }
  const finalStatus = errors.length
    ? retained || added || removed
      ? 'partial'
      : 'failed'
    : 'completed';
  await client
    .from('sales_os_audience_refresh_runs')
    .update({
      status: finalStatus,
      total_evaluated: (members ?? []).length,
      added_count: added,
      removed_count: removed,
      retained_count: retained,
      error_summary: { errors },
      completed_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq('tenant_id', tenantId)
    .eq('id', run.id);
  await client
    .from('sales_os_audience_definitions')
    .update({
      last_seen_at: new Date().toISOString(),
      freshness_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq('tenant_id', tenantId)
    .eq('id', definition.id);
  return {
    status: 'executed' as const,
    success: !errors.length,
    refreshRunId: run.id,
    evaluated: (members ?? []).length,
    added,
    removed,
    retained,
    error: errors.length
      ? {
          code: 'refresh_partial',
          message: `${errors.length} membership updates failed.`,
          retryable: true,
        }
      : undefined,
  };
}

function activationSecret(destination: ActivationDestination) {
  if (!destination.secret_ref) return undefined;
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(destination.secret_ref))
    throw new Error('Activation secret_ref must name an Edge Function secret.');
  return Deno.env.get(destination.secret_ref);
}

function activationPayload(
  member: Record<string, unknown>,
  mapping: Record<string, unknown>,
) {
  const source: Record<string, unknown> = {
    memberId: member.id,
    externalEntityKey: member.external_entity_key,
    accountId: member.account_id,
    contactId: member.contact_id,
    identityType: member.identity_type,
    sourceSystem: member.source_system,
    sourceRecordId: member.source_record_id,
    ...((member.contact ?? {}) as Record<string, unknown>),
    ...((member.account ?? {}) as Record<string, unknown>),
  };
  const mapped: Record<string, unknown> = {};
  for (const [destinationField, sourceField] of Object.entries(mapping)) {
    if (typeof sourceField === 'string' && sourceField in source)
      mapped[destinationField] = source[sourceField];
  }
  return Object.keys(mapped).length ? mapped : source;
}

async function activationReady(client: SupabaseClient, memberId: string) {
  const { data, error } = await client.rpc('sales_os_member_activation_ready', {
    p_tenant_id: tenantId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return Boolean(Array.isArray(data) ? data[0]?.ready : (data?.ready ?? data));
}

async function destinationRequest(
  destination: ActivationDestination,
  method: 'POST' | 'DELETE',
  payload?: Record<string, unknown>,
) {
  if (!destination.endpoint_url)
    throw new Error('Activation destination has no endpoint URL.');
  const secret = activationSecret(destination);
  const response = await fetch(destination.endpoint_url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
  });
  if (response.status === 429) {
    const error = new Error('Activation destination rate limit reached.') as Error & {
      retryable?: boolean;
    };
    error.retryable = true;
    throw error;
  }
  if (!response.ok)
    throw new Error(`Activation destination returned HTTP ${response.status}.`);
  const body = await response.json().catch(() => ({}));
  return body as Record<string, unknown>;
}

export async function executeActivationSyncForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
) {
  const { job, actor } = input;
  const activationId = String(job.input.activationId ?? '');
  if (!activationId) throw new Error('Activation sync jobs require activationId.');
  const { data: activation, error: activationError } = await client
    .from('sales_os_audience_activations')
    .select(
      'id,product_id,audience_id,definition_id,destination_id,status,field_mapping,sync_mode,last_sync_at',
    )
    .eq('tenant_id', tenantId)
    .eq('id', activationId)
    .single();
  if (activationError) throw activationError;
  if (!['approved', 'failed'].includes(activation.status))
    throw new Error('Activation must be approved before syncing.');
  const { data: destination, error: destinationError } = await client
    .from('sales_os_activation_destinations')
    .select('id,destination_type,connector_key,endpoint_url,secret_ref,status')
    .eq('tenant_id', tenantId)
    .eq('id', activation.destination_id)
    .single();
  if (destinationError) throw destinationError;
  if (destination.status !== 'connected')
    throw new Error('Activation destination is disconnected.');
  if (destination.destination_type === 'crm' && destination.connector_key !== 'hubspot')
    throw new Error('Only the HubSpot CRM connector is supported in Phase 9.');
  if (destination.destination_type !== 'csv') activationSecret(destination);

  const mode = String(job.input.mode ?? activation.sync_mode) as
    'full' | 'incremental' | 'retry';
  const runKey = `${tenantId}:${activationId}:${job.id}`;
  const { data: run, error: runError } = await client
    .from('sales_os_activation_sync_runs')
    .upsert(
      {
        tenant_id: tenantId,
        product_id: activation.product_id,
        activation_id: activationId,
        run_type: ['full', 'incremental', 'retry'].includes(mode) ? mode : 'full',
        status: 'running',
        idempotency_key: runKey,
        started_at: new Date().toISOString(),
        created_by: actor,
        updated_by: actor,
      },
      { onConflict: 'tenant_id,activation_id,idempotency_key' },
    )
    .select('id')
    .single();
  if (runError) throw runError;

  await client
    .from('sales_os_audience_activations')
    .update({ status: 'syncing', last_error: null, updated_by: actor })
    .eq('tenant_id', tenantId)
    .eq('id', activationId);
  const { data: members, error: membersError } = await client
    .from('sales_os_audience_members')
    .select(
      'id,account_id,contact_id,identity_type,external_entity_key,source_system,source_record_id,status,suppression_state,consent_state,updated_at',
    )
    .eq('tenant_id', tenantId)
    .eq('audience_id', activation.audience_id)
    .eq('definition_id', activation.definition_id);
  if (membersError) throw membersError;
  const allRows = members ?? [];
  const rows =
    mode === 'incremental' && activation.last_sync_at
      ? allRows.filter(
          (member) => String(member.updated_at ?? '') > String(activation.last_sync_at),
        )
      : allRows;
  const accountIds = rows
    .map((member) => member.account_id)
    .filter(Boolean) as string[];
  const contactIds = rows
    .map((member) => member.contact_id)
    .filter(Boolean) as string[];
  const [{ data: accounts }, { data: contacts }] = await Promise.all([
    accountIds.length
      ? client
          .from('sales_os_accounts')
          .select('*')
          .eq('tenant_id', tenantId)
          .in('id', accountIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? client
          .from('sales_os_contacts')
          .select('*')
          .eq('tenant_id', tenantId)
          .in('id', contactIds)
      : Promise.resolve({ data: [] }),
  ]);
  const accountById = new Map(
    (accounts ?? []).map((account: Record<string, unknown>) => [
      String(account.id),
      account,
    ]),
  );
  const contactById = new Map(
    (contacts ?? []).map((contact: Record<string, unknown>) => [
      String(contact.id),
      contact,
    ]),
  );
  let synced = 0,
    failed = 0,
    suppressed = 0;
  const csvRows: Record<string, unknown>[] = [];
  const errors: Array<Record<string, unknown>> = [];
  for (const member of rows) {
    const ready = await activationReady(client, member.id);
    if (!ready) {
      suppressed += 1;
      await client.from('sales_os_activation_records').upsert(
        {
          tenant_id: tenantId,
          product_id: activation.product_id,
          activation_id: activationId,
          member_id: member.id,
          status: 'suppressed',
          suppression_state: 'suppressed',
          error_code: 'activation_gate',
          error_detail:
            'Member failed current readiness, consent, or suppression gate.',
          updated_by: actor,
        },
        { onConflict: 'tenant_id,activation_id,member_id' },
      );
      continue;
    }
    try {
      const enrichedMember = {
        ...member,
        account: member.account_id ? accountById.get(member.account_id) : null,
        contact: member.contact_id ? contactById.get(member.contact_id) : null,
      };
      const payload = activationPayload(
        enrichedMember as Record<string, unknown>,
        (activation.field_mapping ?? {}) as Record<string, unknown>,
      );
      if (destination.destination_type === 'csv') csvRows.push(payload);
      else {
        const response = await destinationRequest(destination, 'POST', payload);
        const externalId = String(
          response.id ?? response.recordId ?? `sales_os:${activationId}:${member.id}`,
        );
        await client.from('sales_os_activation_records').upsert(
          {
            tenant_id: tenantId,
            product_id: activation.product_id,
            activation_id: activationId,
            member_id: member.id,
            destination_record_id: externalId,
            status: 'synced',
            suppression_state: 'clear',
            synced_at: new Date().toISOString(),
            payload_hash: await hashPayload(payload),
            updated_by: actor,
          },
          { onConflict: 'tenant_id,activation_id,member_id' },
        );
      }
      if (destination.destination_type === 'csv')
        await client.from('sales_os_activation_records').upsert(
          {
            tenant_id: tenantId,
            product_id: activation.product_id,
            activation_id: activationId,
            member_id: member.id,
            destination_record_id: `sales_os:${activationId}:${member.id}`,
            status: 'synced',
            suppression_state: 'clear',
            synced_at: new Date().toISOString(),
            payload_hash: await hashPayload(payload),
            updated_by: actor,
          },
          { onConflict: 'tenant_id,activation_id,member_id' },
        );
      synced += 1;
    } catch (error) {
      failed += 1;
      const detail =
        error instanceof Error ? error.message : 'Destination request failed.';
      errors.push({ memberId: member.id, error: detail });
      await client.from('sales_os_activation_records').upsert(
        {
          tenant_id: tenantId,
          product_id: activation.product_id,
          activation_id: activationId,
          member_id: member.id,
          status: 'failed',
          error_code: 'destination_error',
          error_detail: detail,
          updated_by: actor,
        },
        { onConflict: 'tenant_id,activation_id,member_id' },
      );
    }
  }
  const { data: existingRecords } = await client
    .from('sales_os_activation_records')
    .select('id,member_id,destination_record_id,status')
    .eq('tenant_id', tenantId)
    .eq('activation_id', activationId)
    .in('status', ['synced', 'failed']);
  const currentReady = new Set(
    allRows
      .filter(
        (member) => member.status === 'ready' && member.suppression_state === 'clear',
      )
      .map((member) => member.id),
  );
  for (const record of existingRecords ?? []) {
    if (currentReady.has(record.member_id)) continue;
    try {
      if (destination.destination_type !== 'csv' && record.destination_record_id)
        await destinationRequest(destination, 'DELETE', {
          id: record.destination_record_id,
        });
      await client
        .from('sales_os_activation_records')
        .update({
          status: 'removed',
          suppression_state: 'suppressed',
          updated_by: actor,
          error_detail:
            'Removed during reconciliation because the member is no longer activation-ready.',
        })
        .eq('tenant_id', tenantId)
        .eq('id', record.id);
      await client.from('sales_os_events').insert({
        tenant_id: tenantId,
        product_id: activation.product_id,
        audience_id: activation.audience_id,
        event_type: 'activation_member_removed',
        occurred_at: new Date().toISOString(),
        dimensions: {
          activationId,
          memberId: record.member_id,
          reason: 'not_activation_ready',
        },
        idempotency_key: `${runKey}:removed:${record.member_id}`,
        created_by: actor,
      });
    } catch (error) {
      errors.push({
        memberId: record.member_id,
        error: error instanceof Error ? error.message : 'Removal failed.',
      });
      failed += 1;
    }
  }
  if (destination.destination_type === 'csv') {
    const header = Array.from(new Set(csvRows.flatMap((row) => Object.keys(row))));
    const csv = [
      header,
      ...csvRows.map((row) => header.map((key) => String(row[key] ?? ''))),
    ]
      .map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
      .join('\n');
    await client
      .from('sales_os_activation_sync_runs')
      .update({ export_content: csv })
      .eq('tenant_id', tenantId)
      .eq('id', run.id);
  }
  const status = failed ? (synced ? 'partial' : 'failed') : 'completed';
  await client
    .from('sales_os_activation_sync_runs')
    .update({
      status,
      total_count: rows.length,
      synced_count: synced,
      failed_count: failed,
      suppressed_count: suppressed,
      completed_at: new Date().toISOString(),
      error_summary: { errors },
      updated_by: actor,
    })
    .eq('tenant_id', tenantId)
    .eq('id', run.id);
  await client
    .from('sales_os_audience_activations')
    .update({
      status: failed ? 'failed' : 'completed',
      last_sync_at: new Date().toISOString(),
      last_error: failed ? `${failed} record(s) failed.` : null,
      updated_by: actor,
    })
    .eq('tenant_id', tenantId)
    .eq('id', activationId);
  await client.from('sales_os_events').insert({
    tenant_id: tenantId,
    product_id: activation.product_id,
    audience_id: activation.audience_id,
    event_type: failed ? 'activation_sync_partial' : 'activation_sync_completed',
    occurred_at: new Date().toISOString(),
    dimensions: {
      activationId,
      syncRunId: run.id,
      total: rows.length,
      synced,
      failed,
      suppressed,
    },
    idempotency_key: `${runKey}:completed`,
    created_by: actor,
  });
  return {
    status: 'executed' as const,
    success: !failed,
    activationId,
    syncRunId: run.id,
    total: rows.length,
    synced,
    failed,
    suppressed,
    error:
      failed && !synced
        ? {
            code: 'activation_records_failed',
            message: `${failed} record(s) failed.`,
            retryable: true,
          }
        : undefined,
  };
}

async function hashPayload(payload: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function recomputeAttributionForWorker(
  client: SupabaseClient,
  input: { job: WorkerJobInput; actor: string },
) {
  const conversionId = String(input.job.input.conversionId ?? '');
  if (!conversionId) throw new Error('Attribution jobs require a conversionId.');
  const { data: conversion, error: conversionError } = await client
    .from('sales_os_conversions')
    .select(
      'id,product_id,converted_at,attribution_window_days,last_touch_engagement_id,last_touch_dimensions',
    )
    .eq('tenant_id', tenantId)
    .eq('id', conversionId)
    .single();
  if (conversionError) throw conversionError;
  const { data: events, error: eventsError } = await client
    .from('sales_os_events')
    .select('id,event_type,occurred_at,opportunity_id,engagement_id,dimensions')
    .eq('tenant_id', tenantId)
    .eq('product_id', conversion.product_id)
    .lte('occurred_at', conversion.converted_at)
    .order('occurred_at', { ascending: true });
  if (eventsError) throw eventsError;
  const attribution = calculateAttribution(
    events ?? [],
    conversion.converted_at,
    conversion.attribution_window_days,
  );
  const nextId = attribution.lastTouch?.engagement_id ?? null;
  if (nextId === conversion.last_touch_engagement_id)
    return { status: 'unchanged' as const, conversionId };
  const { error: updateError } = await client
    .from('sales_os_conversions')
    .update({
      last_touch_engagement_id: nextId,
      last_touch_dimensions: attribution.lastTouch?.dimensions ?? {},
      updated_by: input.actor,
    })
    .eq('tenant_id', tenantId)
    .eq('id', conversion.id);
  if (updateError) throw updateError;
  const { error: historyError } = await client
    .from('sales_os_conversion_attribution_history')
    .insert({
      tenant_id: tenantId,
      conversion_id: conversion.id,
      previous_last_touch_engagement_id: conversion.last_touch_engagement_id,
      next_last_touch_engagement_id: nextId,
      previous_last_touch_dimensions: conversion.last_touch_dimensions ?? {},
      next_last_touch_dimensions: attribution.lastTouch?.dimensions ?? {},
      reason: 'late_event_recomputation',
      created_by: input.actor,
    });
  if (historyError) throw historyError;
  return { status: 'updated' as const, conversionId, lastTouchEngagementId: nextId };
}

function countEventTypes(events: Array<Record<string, unknown>>) {
  return events.reduce<Record<string, number>>((counts, event) => {
    const key = String(event.event_type ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

async function loadProviders(client: SupabaseClient, capability: string) {
  const databaseCapability = capability.replace(
    /[A-Z]/g,
    (letter) => '_' + letter.toLowerCase(),
  );
  const { data, error } = await client
    .from('sales_os_providers')
    .select('id,provider_key,capability,enabled,priority')
    .eq('tenant_id', tenantId)
    .in('capability', [capability, databaseCapability])
    .eq('enabled', true)
    .order('priority', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ProviderRow[]).filter((row) =>
    ['openai', 'anthropic', 'exa', 'firecrawl', 'gmail', 'reddit', 'reddit_web', 'hunter'].includes(
      row.provider_key,
    ),
  );
}

async function callProvider(
  provider: string,
  capability: string,
  input: Record<string, unknown>,
): Promise<CapabilityResult> {
  if (provider === 'openai') return callOpenAi(capability, input);
  if (provider === 'anthropic') return callAnthropic(capability, input);
  if (provider === 'exa') return callExa(capability, input);
  if (provider === 'hunter') {
    const key = envFirst('SALES_OS_HUNTER_API_KEY', 'HUNTER_API_KEY');
    if (!key) return unavailable('hunter', 'Hunter API key is missing.');
    const startedAt = Date.now();
    try {
      const data = await executeHunter(capability, input, key);
      return {provider, success:true, data, cost:0, latencyMs:Date.now()-startedAt};
    } catch (error) {
      return {provider,success:false,data:null,cost:0,latencyMs:Date.now()-startedAt,error:{
        code:error instanceof ContactProviderError?error.code:'contact_provider_error',
        message:error instanceof Error?error.message:'Contact provider failed.',
        retryable:error instanceof ContactProviderError?error.retryable:true,
      }};
    }
  }
  if (provider === 'firecrawl') return callFirecrawl(capability, input);
  if (provider === 'gmail') return callGmail(capability, input);
  if (provider === 'reddit' || provider === 'reddit_web') return callReddit(capability, input);
  throw new Error(`Unsupported worker provider: ${provider}`);
}

async function callOpenAi(
  capability: string,
  input: Record<string, unknown>,
): Promise<CapabilityResult> {
  const key = envFirst('SALES_OS_OPENAI_API_KEY', 'OPENAI_API_KEY');
  const model = envFirst('SALES_OS_OPENAI_MODEL', 'OPENAI_MODEL');
  if (!key || !model)
    return unavailable('openai', 'OpenAI model configuration is missing.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: JSON.stringify({ capability, ...input }) }),
  });
  const payload = await response.json();
  if (!response.ok)
    return unavailable(
      'openai',
      payload?.error?.message ?? 'OpenAI request failed.',
      response.status,
    );
  return {
    provider: 'openai',
    success: true,
    data: parseJson(payload.output_text ?? ''),
    cost: 0,
    latencyMs: 0,
  };
}

async function callAnthropic(
  capability: string,
  input: Record<string, unknown>,
): Promise<CapabilityResult> {
  const key = envFirst('SALES_OS_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
  const model = envFirst('SALES_OS_ANTHROPIC_MODEL', 'CLAUDE_MODEL');
  if (!key || !model)
    return unavailable('anthropic', 'Anthropic model configuration is missing.');
  const useStructuredTool = [
    'product_sales_profile',
    'generate_audience_hypotheses',
    'generate_engagement_draft',
  ].includes(String(input.task));
  const structuredTool = anthropicStructuredTool(input);
  const requestBody: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: anthropicRequestMessage(capability, input),
      },
    ],
  };
  if (useStructuredTool) {
    requestBody.tools = [structuredTool];
    requestBody.tool_choice = { type: 'tool', name: structuredTool.name };
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });
  const payload = await response.json();
  if (!response.ok)
    return unavailable(
      'anthropic',
      payload?.error?.message ?? 'Anthropic request failed.',
      response.status,
    );
  const text =
    payload.content?.find((entry: { type?: string }) => entry.type === 'text')?.text ??
    '';
  const toolInput = useStructuredTool
    ? payload.content?.find(
        (entry: { type?: string; name?: string; input?: unknown }) =>
          entry.type === 'tool_use' && entry.name === structuredTool.name,
      )?.input
    : undefined;
  return {
    provider: 'anthropic',
    success: true,
    data: toolInput ?? parseJson(text),
    cost: 0,
    latencyMs: 0,
  };
}

function anthropicStructuredTool(input: Record<string, unknown>) {
  const isProductProfile = input.task === 'product_sales_profile';
  const isAudienceHypotheses = input.task === 'generate_audience_hypotheses';
  const isEngagementDraft = input.task === 'generate_engagement_draft';
  return {
    name: 'sales_os_structured_output',
    description: isProductProfile
      ? 'Return the complete product sales profile as structured data.'
      : isAudienceHypotheses
        ? 'Return audience hypotheses with proposed routes as structured data.'
        : 'Return the requested Sales OS result as a JSON object.',
    input_schema: isProductProfile
      ? {
          type: 'object',
          additionalProperties: false,
          required: [
            'product',
            'category',
            'description',
            'problemsSolved',
            'coreCapabilities',
            'primaryUseCases',
            'pricingBusinessModel',
            'conversionEvent',
            'purchaseFriction',
            'competitiveAlternatives',
            'purchaseTriggers',
            'positioningValueProps',
            'sourceEvidence',
            'outreachMotion',
            'outreachMotionReason',
            'collateralStrategy',
          ],
          properties: {
            product: { type: 'string' },
            category: { type: 'string' },
            description: { type: 'string' },
            problemsSolved: { type: 'array', items: { type: 'string' } },
            coreCapabilities: { type: 'array', items: { type: 'string' } },
            primaryUseCases: { type: 'array', items: { type: 'string' } },
            pricingBusinessModel: { type: 'object' },
            conversionEvent: { type: 'object' },
            purchaseFriction: { type: 'string' },
            competitiveAlternatives: { type: 'array', items: { type: 'string' } },
            purchaseTriggers: { type: 'array', items: { type: 'string' } },
            positioningValueProps: { type: 'array', items: { type: 'string' } },
            sourceEvidence: { type: 'array', items: { type: 'object' } },
            outreachMotion: {
              type: 'string',
              enum: ['b2b', 'b2c', 'b2b2c', 'community'],
            },
            outreachMotionReason: { type: 'string' },
            collateralStrategy: { type: 'object' },
            displayLabels: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                description: { type: 'string' },
                problemsSolved: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      source: { type: 'string' },
                    },
                    required: ['label', 'source'],
                  },
                },
                primaryUseCases: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      source: { type: 'string' },
                    },
                    required: ['label', 'source'],
                  },
                },
                competitiveAlternatives: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      source: { type: 'string' },
                    },
                    required: ['label', 'source'],
                  },
                },
                purchaseFriction: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      source: { type: 'string' },
                    },
                    required: ['label', 'source'],
                  },
                },
                conversionEvent: { type: 'object' },
              },
            },
          },
        }
      : isAudienceHypotheses
        ? {
            type: 'object',
            additionalProperties: false,
            required: ['audiences'],
            properties: {
              audiences: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  required: [
                    'name',
                    'buyerType',
                    'problemUseCaseFit',
                    'coreProblem',
                    'whyProductFits',
                    'purchaseTrigger',
                    'currentAlternative',
                    'buyingMotivation',
                    'purchaseFriction',
                    'buyingBehavior',
                    'budgetFit',
                    'purchaseReadiness',
                    'commercialEvidence',
                    'validationRationale',
                    'purchaseTriggers',
                    'relevantTerminology',
                    'supportingEvidence',
                    'aiFitAssessment',
                    'routes',
                  ],
                  properties: {
                    name: { type: 'string' },
                    buyerType: { type: 'string', enum: ['individual', 'organization'] },
                    problemUseCaseFit: { type: 'string' },
                    coreProblem: { type: 'string' },
                    whyProductFits: { type: 'string' },
                    purchaseTrigger: { type: 'string' },
                    currentAlternative: { type: 'string' },
                    buyingMotivation: { type: 'string' },
                    purchaseFriction: { type: 'string' },
                    buyingBehavior: { type: 'object' },
                    budgetFit: { type: 'string' },
                    purchaseReadiness: { type: 'string' },
                    commercialEvidence: { type: 'array', items: { type: 'object' } },
                    validationRationale: { type: 'string' },
                    purchaseTriggers: { type: 'array', items: { type: 'string' } },
                    relevantTerminology: { type: 'array', items: { type: 'string' } },
                    supportingEvidence: { type: 'array', items: { type: 'object' } },
                    aiFitAssessment: { type: 'string' },
                    routes: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          }
        : isEngagementDraft
          ? {
              type: 'object',
              additionalProperties: false,
              required: [
                'objective',
                'whyEngage',
                'messageAngle',
                'cta',
                'draftContent',
                'followUpStrategy',
                'riskSensitivity',
              ],
              properties: {
                objective: { type: 'string' },
                whyEngage: { type: 'string' },
                messageAngle: { type: 'string' },
                cta: { type: 'string' },
                draftContent: { type: 'string' },
                subject: { type: 'string' },
                followUpStrategy: { type: 'object' },
                riskSensitivity: { type: 'string' },
                previousInteraction: { type: 'object' },
              },
            }
          : {
              type: 'object',
              additionalProperties: true,
            },
  };
}

function anthropicRequestMessage(
  capability: string,
  input: Record<string, unknown>,
): string {
  const instruction =
    input.task === 'generate_audience_hypotheses'
      ? 'Return only a JSON object with a non-empty audiences array. Return up to 6 materially distinct ICPs: one primary candidate and no more than five secondary candidates. Each audience must include non-empty name, buyerType, outreachMotion (b2b, b2c, b2b2c, or community), outreachMotionReason, collateralStrategy, problemUseCaseFit, coreProblem, whyProductFits, purchaseTrigger, currentAlternative, buyingMotivation, purchaseFriction, buyingBehavior, budgetFit, purchaseReadiness, commercialEvidence, validationRationale, commercialIntentScore, purchaseTriggers, relevantTerminology, supportingEvidence, aiFitAssessment, priority, and routes. For organization audiences, buyingBehavior must separately identify buyer, influencer, and endUser. Also include displayLabels with short user-facing name, problem, and purchaseTriggers labels. Complete missing details using the product profile and research context; label inferred values as AI inference and set completion.requiresHumanReview=true. Never return empty strings, nulls, Unknown, Unavailable, or Pending human review. Do not invent source evidence. Each route must be social or direct, with at least one route per audience.'
      : input.task === 'product_sales_profile'
        ? 'Populate every required product profile field in the tool input. Also populate displayLabels following input.outputRequirements.displayLabelRules when possible. Do not submit an empty object.'
        : input.task === 'generate_engagement_draft'
          ? 'Populate objective, whyEngage, messageAngle, cta, draftContent, followUpStrategy, and riskSensitivity in the tool input. Include subject for email when applicable. Draft channel-appropriate collateral based on the approved ICP and opportunity evidence. draftContent must contain exactly one message for the requested channel and copy type. Do not include versions for other channels, section headings, labels such as For Reddit:, or surrounding quotation marks. This is first-touch outreach: introduce input.copyGrounding.productName, describe capabilities as features of that product, and never imply the recipient already uses or has access to an internal feature. Do not write your [feature], you use [feature], or you have [feature] unless verified recipient evidence explicitly supports it. Do not submit an empty object.'
          : 'Populate the tool input with the complete requested result. Do not submit an empty object.';
  return `${instruction}\nCapability: ${capability}\nInput:\n${JSON.stringify(input)}`;
}

async function callExa(
  capability: string,
  input: Record<string, unknown>,
): Promise<CapabilityResult> {
  const key = Deno.env.get('SALES_OS_EXA_API_KEY');
  if (!key) return unavailable('exa', 'Exa API key is missing.');
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: capability === 'findCompany' ? directSearchQuery(input) : String(input.query ?? ''),
      numResults: 10,
      contents: { highlights: true },
    }),
  });
  const payload = await response.json();
  if (!response.ok)
    return unavailable('exa', payload?.error ?? 'Exa request failed.', response.status);
  return {
    provider: 'exa',
    success: true,
    data: capability === 'findCompany' ? normalizeCompanyResults(payload) : payload.results ?? [],
    cost: 0,
    latencyMs: 0,
  };
}

async function callFirecrawl(
  capability: string,
  input: Record<string, unknown>,
): Promise<CapabilityResult> {
  const key = Deno.env.get('SALES_OS_FIRECRAWL_API_KEY');
  if (!key) return unavailable('firecrawl', 'Firecrawl API key is missing.');
  const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url: String(input.url ?? ''), formats: ['markdown'] }),
  });
  const payload = await response.json();
  if (!response.ok)
    return unavailable(
      'firecrawl',
      payload?.error ?? 'Firecrawl request failed.',
      response.status,
    );
  return {
    provider: 'firecrawl',
    success: true,
    data: payload.data ?? payload,
    cost: 0,
    latencyMs: 0,
  };
}

async function callReddit(
  capability: string,
  input: Record<string, unknown>,
): Promise<CapabilityResult> {
  if (capability !== 'searchCommunity')
    return unavailable('reddit', `Reddit does not support ${capability}.`);
  const token = envFirst('SALES_OS_REDDIT_ACCESS_TOKEN', 'REDDIT_ACCESS_TOKEN');
  if (!token) return unavailable('reddit', 'Reddit access token is missing.');
  const response = await fetch(
    `https://oauth.reddit.com/search.json?q=${encodeURIComponent(String(input.query ?? ''))}&limit=${Math.min(Number(input.numResults ?? 20), 100)}&sort=relevance&t=all`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        'user-agent':
          envFirst('SALES_OS_REDDIT_USER_AGENT', 'REDDIT_USER_AGENT') ?? 'sales-os/1.0',
      },
    },
  );
  const payload = await response.json();
  if (!response.ok)
    return unavailable(
      'reddit',
      payload?.message ?? 'Reddit search failed.',
      response.status,
    );
  return {
    provider: 'reddit',
    success: true,
    data: payload?.data ?? payload,
    cost: 0,
    latencyMs: 0,
  };
}

async function callGmail(
  capability: string,
  input: Record<string, unknown>,
): Promise<CapabilityResult> {
  const key = Deno.env.get('SALES_OS_GMAIL_ACCESS_TOKEN');
  const user = Deno.env.get('SALES_OS_GMAIL_USER') ?? 'me';
  if (!key) return unavailable('gmail', 'Gmail access token is missing.');
  if (capability !== 'sendEmail')
    return unavailable('gmail', `Gmail does not support ${capability}.`);
  const raw = [
    `To: ${String(input.to)}`,
    `Subject: ${String(input.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    String(input.content),
  ].join('\r\n');
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages/send`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: encoded }),
    },
  );
  const payload = await response.json();
  if (!response.ok)
    return unavailable(
      'gmail',
      payload?.error?.message ?? 'Gmail send failed.',
      response.status,
    );
  return {
    provider: 'gmail',
    success: true,
    data: payload,
    cost: 0,
    latencyMs: 0,
    externalIds: { messageId: payload.id ?? '', threadId: payload.threadId ?? '' },
  };
}

function unavailable(
  provider: string,
  message: string,
  status?: number,
): CapabilityResult {
  return {
    provider,
    success: false,
    data: null,
    cost: 0,
    latencyMs: 0,
    error: {
      code: status ? `http_${status}` : 'configuration_missing',
      message,
      retryable:
        status === undefined ||
        status === 401 ||
        status === 403 ||
        status === 408 ||
        status === 429 ||
        (status !== undefined && status >= 500),
    },
  };
}

function modelFor(provider: string) {
  return provider === 'openai'
    ? (envFirst('SALES_OS_OPENAI_MODEL', 'OPENAI_MODEL') ?? null)
    : provider === 'anthropic'
      ? (envFirst('SALES_OS_ANTHROPIC_MODEL', 'CLAUDE_MODEL') ?? null)
      : provider;
}

function envFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseJson(value: string): unknown {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string' && parsed.trim() !== trimmed)
      return parseJson(parsed);
    return parsed;
  } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
    if (!fenced) return parseEmbeddedJson(trimmed);
    try {
      return JSON.parse(fenced);
    } catch {
      return parseEmbeddedJson(trimmed);
    }
  }
}

function parseEmbeddedJson(value: string): unknown {
  const objectStart = value.indexOf('{');
  const objectEnd = value.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(value.slice(objectStart, objectEnd + 1));
    } catch {
      // Preserve the original value so validation reports the provider shape.
    }
  }
  return value;
}

function normalizeEvidence(value: unknown, url: string, sourceType: string) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim())
      return [{ url, snippet: item, sourceType }];
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const snippet = String(
        record.snippet ?? record.text ?? record.highlight ?? '',
      ).trim();
      if (snippet) return [{ url: String(record.url ?? url), snippet, sourceType }];
    }
    return [];
  });
}

function buildAudienceEvidenceQuery(profile: Record<string, unknown>): string {
  const terms = [
    profile.category,
    profile.description,
    ...(Array.isArray(profile.problems_solved) ? profile.problems_solved : []),
    ...(Array.isArray(profile.primary_use_cases) ? profile.primary_use_cases : []),
    ...(Array.isArray(profile.purchase_triggers) ? profile.purchase_triggers : []),
  ].filter((value): value is string => typeof value === 'string' && !!value.trim());
  return terms.slice(0, 6).join(' ');
}

function normalizeResearchEvidence(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const snippet = String(
      record.snippet ?? record.text ?? record.highlight ?? record.title ?? '',
    ).trim();
    if (!snippet) return [];
    return [
      {
        url: typeof record.url === 'string' ? record.url : undefined,
        snippet,
        sourceType: 'research',
      },
    ];
  });
}

function validateProfile(value: unknown) {
  if (!value || typeof value !== 'object')
    throw new Error('AI returned an invalid product profile.');
  const rawProfile = value as Record<string, unknown>;
  const profile: Record<string,unknown> = {
    ...rawProfile,
    purchaseFriction: normalizeTextField(rawProfile.purchaseFriction),
    pricingBusinessModel: normalizeRecordField(rawProfile.pricingBusinessModel),
    conversionEvent: normalizeRecordField(rawProfile.conversionEvent),
  };
  const profileStrategy = deriveAudienceStrategy({
    buyerType: rawProfile.buyerType,
    outreachMotion: rawProfile.outreachMotion,
    outreachMotionReason: rawProfile.outreachMotionReason,
    routes: rawProfile.routes,
  });
  profile.outreachMotion = profileStrategy.motion;
  profile.outreachMotionReason = String(
    rawProfile.outreachMotionReason ?? profileStrategy.reason,
  );
  profile.collateralStrategy =
    rawProfile.collateralStrategy && typeof rawProfile.collateralStrategy === 'object'
      ? rawProfile.collateralStrategy
      : profileStrategy.collateral;
  const requiredStrings = ['product', 'category', 'description', 'purchaseFriction'];
  const requiredArrays = [
    'problemsSolved',
    'coreCapabilities',
    'primaryUseCases',
    'competitiveAlternatives',
    'purchaseTriggers',
    'positioningValueProps',
    'sourceEvidence',
  ];
  for (const key of requiredArrays) profile[key] = normalizeArrayField(profile[key]);
  for (const key of requiredStrings)
    if (typeof profile[key] !== 'string' || !String(profile[key]).trim())
      throw new Error(`AI product profile field ${key} is invalid.`);
  for (const key of requiredArrays)
    if (!Array.isArray(profile[key]))
      throw new Error(`AI product profile field ${key} is invalid.`);
  if (!profile.pricingBusinessModel || typeof profile.pricingBusinessModel !== 'object')
    throw new Error('AI product profile pricingBusinessModel is invalid.');
  if (!profile.conversionEvent || typeof profile.conversionEvent !== 'object')
    throw new Error('AI product profile conversionEvent is invalid.');
  return profile as {
    category: string;
    description: string;
    problemsSolved: unknown[];
    coreCapabilities: unknown[];
    primaryUseCases: unknown[];
    pricingBusinessModel: Record<string, unknown>;
    conversionEvent: Record<string, unknown>;
    purchaseFriction: string;
    competitiveAlternatives: unknown[];
    purchaseTriggers: unknown[];
    positioningValueProps: unknown[];
    sourceEvidence: unknown[];
    outreachMotion: OutreachMotion;
    outreachMotionReason: string;
    collateralStrategy: Record<string, unknown>;
  };
}

function normalizeTextField(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTextField(item))
      .filter(Boolean)
      .join('; ');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const normalized = normalizeTextField(item);
        return normalized ? `${key}: ${normalized}` : '';
      })
      .filter(Boolean)
      .join('; ');
  }
  return '';
}

function normalizeArrayField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function normalizeRecordField(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (value === null || value === undefined || value === '') return {};
  return { value };
}

function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (typeof value === 'object')
    return `object(keys=${Object.keys(value as Record<string, unknown>)
      .slice(0, 20)
      .join(',')})`;
  return typeof value;
}

async function transitionProduct(
  client: SupabaseClient,
  productId: string,
  from: string,
  to: string,
  actor: string,
) {
  const { error } = await client
    .from('sales_os_products')
    .update({ status: to, updated_by: actor, state_changed_by: actor })
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .eq('status', from);
  if (error) throw error;
}

async function recordWorkflowLineage(
  client: SupabaseClient,
  input: {
    productId: string;
    relationType:
      | 'source_to_profile'
      | 'profile_to_icp'
      | 'icp_to_audience'
      | 'audience_to_outreach_decision'
      | 'outreach_decision_to_copy';
    sourceId?: string | null;
    profileId?: string | null;
    icpId?: string | null;
    audienceId?: string | null;
    outreachDecisionId?: string | null;
    engagementId?: string | null;
    actor: string;
  },
) {
  const { error } = await client.from('sales_os_workflow_lineage').upsert(
    {
      tenant_id: tenantId,
      product_id: input.productId,
      source_id: input.sourceId ?? null,
      profile_id: input.profileId ?? null,
      icp_id: input.icpId ?? null,
      audience_id: input.audienceId ?? null,
      outreach_decision_id: input.outreachDecisionId ?? null,
      engagement_id: input.engagementId ?? null,
      relation_type: input.relationType,
      metadata: {},
      created_by: input.actor,
    },
    {
      onConflict:
        'tenant_id,product_id,relation_type,source_id,profile_id,icp_id,audience_id,outreach_decision_id,engagement_id',
    },
  );
  if (error) throw error;
}

async function finishRun(
  client: SupabaseClient,
  runId: string,
  result: CapabilityResult,
  status: 'succeeded' | 'failed',
) {
  const { error } = await client
    .from('sales_os_provider_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      latency_ms: result.latencyMs,
      actual_cost: result.cost,
      error_code: result.error?.code ?? null,
      error_detail: result.error?.message ?? null,
    })
    .eq('tenant_id', tenantId)
    .eq('id', runId);
  if (error) throw error;
}

async function finalizeReservation(
  client: SupabaseClient,
  reservationId: string | null,
  status: 'released' | 'consumed',
  actor: string,
) {
  if (!reservationId) return;
  const { error } = await client
    .from('sales_os_budget_reservations')
    .update({ status, updated_by: actor })
    .eq('tenant_id', tenantId)
    .eq('id', reservationId);
  if (error) throw error;
}

async function releaseReservation(
  client: SupabaseClient,
  id: string | null,
  actor: string,
) {
  await finalizeReservation(client, id, 'released', actor);
}

import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';
import { transitionState } from '../state/transitionService';
import { persistProductProfile } from './profileService';
import { ProductSalesProfileSchema, type ProductSalesProfile } from './schemas';

export function validateProductAnalysisOutput(input: unknown): ProductSalesProfile {
  return ProductSalesProfileSchema.parse(input);
}

export async function analyzeProduct(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId: string;
    currentProductStatus: 'draft' | 'analyzing';
    productContext: Record<string, unknown>;
    estimatedCost: number;
    actor: string;
  },
) {
  if (input.currentProductStatus === 'draft') {
    await transitionState(client, {
      entity: 'product',
      id: input.productId,
      from: 'draft',
      to: 'analyzing',
      actor: input.actor,
    });
  }

  const productUrl =
    typeof input.productContext.websiteUrl === 'string'
      ? input.productContext.websiteUrl
      : undefined;
  let sourceEvidence: unknown[] = [];
  if (productUrl) {
    const scrape = await executeCapabilityWithBudget(
      client,
      registry,
      recorder,
      'scrapePage',
      { url: productUrl },
      {
        productId: input.productId,
        jobId: input.jobId,
        estimatedCost: input.estimatedCost,
        actor: input.actor,
        requestReference: `product-scrape:${input.productId}`,
      },
    );
    if (scrape.status === 'executed' && scrape.result.success)
      sourceEvidence = scrape.result.evidence ?? [scrape.result.data];
    if (!sourceEvidence.length) {
      const search = await executeCapabilityWithBudget(
        client,
        registry,
        recorder,
        'searchWeb',
        { query: productUrl },
        {
          productId: input.productId,
          jobId: input.jobId,
          estimatedCost: input.estimatedCost,
          actor: input.actor,
          requestReference: `product-search:${input.productId}`,
        },
      );
      if (search.status === 'executed' && search.result.success)
        sourceEvidence = search.result.evidence ?? [search.result.data];
    }
  }

  const executionContext: ProviderExecutionContext = {
    productId: input.productId,
    jobId: input.jobId,
    estimatedCost: input.estimatedCost,
    actor: input.actor,
  };
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'reasoning',
    { task: 'product_sales_profile', product: input.productContext, sourceEvidence },
    executionContext,
  );
  if (result.status !== 'executed' || !result.result.success) return result;

  const profile = validateProductAnalysisOutput(result.result.data);
  const persisted = await persistProductProfile(client, input.productId, profile, 'ai');
  await transitionState(client, {
    entity: 'product',
    id: input.productId,
    from: 'analyzing',
    to: 'audience_review',
    actor: input.actor,
  });
  return { ...result, profile, persisted };
}

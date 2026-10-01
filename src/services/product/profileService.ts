import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import { ProductSalesProfileSchema, type ProductSalesProfile } from './schemas';

export function buildProfileInsert(
  productId: string,
  profile: ProductSalesProfile,
  version: number,
  actor: 'user' | 'ai',
) {
  const validated = ProductSalesProfileSchema.parse(profile);
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: productId,
    version,
    category: validated.category,
    description: validated.description,
    problems_solved: validated.problemsSolved,
    core_capabilities: validated.coreCapabilities,
    primary_use_cases: validated.primaryUseCases,
    pricing_business_model: validated.pricingBusinessModel,
    conversion_event: validated.conversionEvent,
    purchase_friction: validated.purchaseFriction,
    competitive_alternatives: validated.competitiveAlternatives,
    purchase_triggers: validated.purchaseTriggers,
    positioning_value_props: validated.positioningValueProps,
    source_evidence: validated.sourceEvidence,
    is_active: false,
    review_status: 'needs_review',
    created_by: actor,
  };
}

export async function persistProductProfile(
  client: SupabaseClient,
  productId: string,
  profile: ProductSalesProfile,
  actor: 'user' | 'ai',
) {
  const { data: current, error: currentError } = await client
    .from('sales_os_product_profiles')
    .select('version')
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('product_id', productId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (currentError) throw currentError;

  const { data, error } = await client
    .from('sales_os_product_profiles')
    .insert(buildProfileInsert(productId, profile, (current?.version ?? 0) + 1, actor))
    .select()
    .single();
  if (error) throw error;
  return data;
}

import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import { buildJobIdempotencyKey, persistJob } from '../jobs/jobService';
import { persistProductSource, type ProductSourceInput } from './sourceService';
import { ProductCreateInputSchema, type ProductCreateInput } from './schemas';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function chooseAvailableSlug(
  baseSlug: string,
  existingSlugs: readonly string[],
): string {
  const existing = new Set(existingSlugs);
  if (!existing.has(baseSlug)) return baseSlug;
  let suffix = 2;
  while (existing.has(`${baseSlug}-${suffix}`)) suffix += 1;
  return `${baseSlug}-${suffix}`;
}

export function buildProductInsert(input: ProductCreateInput, actor: string) {
  const validated = ProductCreateInputSchema.parse(input);
  return {
    tenant_id: SALES_OS_TENANT_ID,
    name: validated.name,
    slug: slugify(validated.name),
    website_url: validated.websiteUrl || null,
    description_input: validated.descriptionInput || null,
    primary_objective: validated.primaryObjective || null,
    geographic_constraints: validated.geographicConstraints
      ? { raw: validated.geographicConstraints }
      : null,
    additional_context:
      [
        validated.pricingBusinessModel,
        validated.knownAudiences,
        validated.additionalContext,
      ]
        .filter(Boolean)
        .join('\n\n') || null,
    monthly_spend_cap: validated.monthlySpendCap,
    per_run_spend_cap: validated.perRunSpendCap,
    currency: validated.currency,
    created_by: actor,
    updated_by: actor,
  };
}

export function buildProductAnalysisJobInsert(
  productId: string,
  input: ProductCreateInput,
  actor: string,
) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: productId,
    job_type: 'product_analysis',
    status: 'queued',
    input: { product: input },
    progress: { stage: 'queued' },
    result: {},
    created_by: actor,
    updated_by: actor,
  };
}

export async function createProduct(
  client: SupabaseClient,
  input: ProductCreateInput,
  actor: string,
  source?: ProductSourceInput,
) {
  const productInsert = buildProductInsert(input, actor);
  let product: (Record<string, unknown> & { id: string }) | null = null;
  let productError: { code?: string; message: string } | null = null;
  let attemptedSlug = productInsert.slug;

  const { data: existingRows, error: existingError } = await client
    .from('sales_os_products')
    .select('slug')
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .like('slug', `${productInsert.slug}%`);
  if (existingError) throw existingError;
  attemptedSlug = chooseAvailableSlug(
    productInsert.slug,
    (existingRows ?? []).map((row) => String(row.slug)),
  );

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (attempt > 0) {
      const { data: existingRows, error: existingError } = await client
        .from('sales_os_products')
        .select('slug')
        .eq('tenant_id', SALES_OS_TENANT_ID)
        .like('slug', `${productInsert.slug}%`);
      if (existingError) throw existingError;
      attemptedSlug = chooseAvailableSlug(
        productInsert.slug,
        (existingRows ?? []).map((row) => String(row.slug)),
      );
    }

    const result = await client
      .from('sales_os_products')
      .insert({ ...productInsert, slug: attemptedSlug })
      .select()
      .single();
    if (!result.error) {
      product = result.data as Record<string, unknown> & { id: string };
      productError = null;
      break;
    }
    productError = result.error;
    if (
      result.error.code !== '23505' ||
      !result.error.message.includes('sales_os_products_tenant_id_slug_key')
    )
      throw result.error;
  }

  if (productError || !product)
    throw productError ?? new Error('Unable to create product.');

  if (source) await persistProductSource(client, product.id, source, actor);

  const job = await persistJob(client, {
    productId: product.id,
    jobType: 'product_analysis',
    payload: { product: input },
    actor,
    idempotencyKey: buildJobIdempotencyKey({
      productId: product.id,
      jobType: 'product_analysis',
      scope: product.id,
    }),
  });
  return { product, job };
}

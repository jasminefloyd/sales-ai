import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';

export type ProductSourceInput = {
  sourceType: 'file' | 'free_text' | 'website';
  fileName?: string | null;
  mimeType?: string | null;
  content: string;
  parsedFields: Record<string, unknown>;
};

export function buildProductSourceInsert(
  productId: string,
  source: ProductSourceInput,
  actor: string,
) {
  if (!source.content.trim()) throw new Error('Product source content is required.');
  if (source.sourceType === 'file' && !source.fileName?.trim())
    throw new Error('Imported files must include a file name.');

  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: productId,
    source_type: source.sourceType,
    file_name: source.fileName?.trim() || null,
    mime_type: source.mimeType?.trim() || null,
    content: source.content,
    parse_status: 'parsed',
    parsed_fields: source.parsedFields,
    parse_error: null,
    created_by: actor,
    updated_by: actor,
  };
}

export async function persistProductSource(
  client: SupabaseClient,
  productId: string,
  source: ProductSourceInput,
  actor: string,
) {
  const { data, error } = await client
    .from('sales_os_product_sources')
    .insert(buildProductSourceInsert(productId, source, actor))
    .select()
    .single();
  if (error) throw error;
  return data;
}

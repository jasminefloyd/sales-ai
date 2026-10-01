import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function editProductProfile(input: {
  productId: string;
  updates: Record<string, unknown>;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-edit-product-profile',
    { body: input },
  );
  if (error) throw error;
  return data;
}

export async function reviewProductProfile(input: {
  productId: string;
  action: 'approve' | 'reject';
  reviewNotes?: string;
}) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-review-product-profile',
    { body: input },
  );
  if (error) throw error;
  return data;
}

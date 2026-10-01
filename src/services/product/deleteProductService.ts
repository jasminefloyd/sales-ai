import { supabaseBrowserClient } from '../../lib/supabase/browser';

export async function deleteProduct(productId: string, confirmName: string) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-delete-product',
    { body: { productId, confirmName } },
  );
  if (error) {
    const response = error.context;
    if (response instanceof Response) {
      try {
        const payload = (await response.clone().json()) as {
          error?: string;
          details?: string | null;
          hint?: string | null;
          code?: string | null;
        };
        const parts = [payload.error, payload.details, payload.hint].filter(
          (value): value is string => Boolean(value),
        );
        if (parts.length) throw new Error(parts.join(' · '));
      } catch (parseError) {
        if (
          parseError instanceof Error &&
          parseError.message !== 'Unexpected end of JSON input'
        ) {
          throw parseError;
        }
      }
    }
    throw error;
  }
  return data;
}

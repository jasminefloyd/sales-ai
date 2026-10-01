import { createClient } from 'npm:@supabase/supabase-js@2';

const tenantId = 'sales_os';
const supabaseUrl = Deno.env.get('SALES_OS_SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SALES_OS_SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey)
  throw new Error('Missing Sales OS server Supabase configuration.');

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer '))
      throw new Error('Authentication required.');
    const { data: userData, error: userError } = await client.auth.getUser(
      authorization.slice(7),
    );
    if (userError || !userData.user) throw new Error('Authentication required.');
    const body = (await request.json()) as {
      productId?: string;
      confirmName?: string;
    };
    if (!body.productId || !body.confirmName)
      throw new Error('productId and confirmName are required.');
    const { data: product, error: productError } = await client
      .from('sales_os_products')
      .select('id,name')
      .eq('tenant_id', tenantId)
      .eq('id', body.productId)
      .single();
    if (productError) throw productError;
    if (body.confirmName !== product.name)
      throw new Error('Product name confirmation did not match.');
    const { data, error } = await client.rpc('sales_os_delete_product', {
      p_product_id: product.id,
      p_actor: userData.user.id,
    });
    if (error) throw error;
    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorRecord = error as {
      message?: string;
      details?: string | null;
      hint?: string | null;
      code?: string | null;
    };
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : (errorRecord?.message ?? 'Product deletion failed.'),
        details: errorRecord?.details ?? null,
        hint: errorRecord?.hint ?? null,
        code: errorRecord?.code ?? null,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

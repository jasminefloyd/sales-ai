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
    const body = (await request.json()) as {
      action?: 'approve' | 'reject' | 'revert';
      candidateId?: string;
      mergeId?: string;
      reviewNotes?: string;
    };
    if (!body.action || (body.action !== 'revert' && !body.candidateId))
      throw new Error('An identity action and candidateId are required.');

    if (body.action === 'revert') {
      if (!body.mergeId)
        throw new Error('mergeId is required to revert an identity merge.');
      const { data: merge, error: mergeError } = await client
        .from('sales_os_identity_merges')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', body.mergeId)
        .eq('status', 'approved')
        .single();
      if (mergeError) throw mergeError;
      if (merge.source_contact_id && merge.target_contact_id) {
        await client
          .from('sales_os_contacts')
          .update({
            identity_state: 'canonical',
            merged_into_contact_id: null,
            updated_by: auth.user.id,
          })
          .eq('tenant_id', tenantId)
          .eq('id', merge.source_contact_id);
        await client
          .from('sales_os_audience_members')
          .update({ contact_id: merge.source_contact_id, updated_by: auth.user.id })
          .eq('tenant_id', tenantId)
          .eq('contact_id', merge.target_contact_id);
      }
      if (merge.source_account_id && merge.target_account_id) {
        await client
          .from('sales_os_accounts')
          .update({
            identity_state: 'canonical',
            merged_into_account_id: null,
            updated_by: auth.user.id,
          })
          .eq('tenant_id', tenantId)
          .eq('id', merge.source_account_id);
        await client
          .from('sales_os_audience_members')
          .update({ account_id: merge.source_account_id, updated_by: auth.user.id })
          .eq('tenant_id', tenantId)
          .eq('account_id', merge.target_account_id);
      }
      const { data, error } = await client
        .from('sales_os_identity_merges')
        .update({
          status: 'reverted',
          reverted_by: auth.user.id,
          reverted_at: new Date().toISOString(),
          reverted_reason: body.reviewNotes ?? null,
          updated_by: auth.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('id', merge.id)
        .select()
        .single();
      if (error) throw error;
      await appendIdentityEvent(
        merge.product_id,
        {
          mergeId: merge.id,
          action: 'reverted',
          sourceAccountId: merge.source_account_id,
          sourceContactId: merge.source_contact_id,
          targetAccountId: merge.target_account_id,
          targetContactId: merge.target_contact_id,
        },
        auth.user.id,
      );
      return json({ data });
    }

    const { data: candidate, error: candidateError } = await client
      .from('sales_os_identity_candidates')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', body.candidateId)
      .single();
    if (candidateError) throw candidateError;
    if (body.action === 'reject') {
      const { data, error } = await client
        .from('sales_os_identity_candidates')
        .update({
          status: 'rejected',
          reviewed_by: auth.user.id,
          reviewed_at: new Date().toISOString(),
          review_notes: body.reviewNotes ?? null,
          updated_by: auth.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('id', candidate.id)
        .select()
        .single();
      if (error) throw error;
      return json({ data });
    }
    if (candidate.match_type !== 'deterministic' && Number(candidate.confidence) < 0.65)
      throw new Error(
        'Low-confidence identity matches require more evidence before approval.',
      );
    const { data: member, error: memberError } = await client
      .from('sales_os_audience_members')
      .select('account_id,contact_id,product_id')
      .eq('tenant_id', tenantId)
      .eq('id', candidate.member_id)
      .single();
    if (memberError) throw memberError;
    const sourceAccountId =
      member.account_id && candidate.candidate_account_id !== member.account_id
        ? member.account_id
        : null;
    const sourceContactId =
      member.contact_id && candidate.candidate_contact_id !== member.contact_id
        ? member.contact_id
        : null;
    const targetAccountId = sourceAccountId ? candidate.candidate_account_id : null;
    const targetContactId = sourceContactId ? candidate.candidate_contact_id : null;
    if (!sourceAccountId && !sourceContactId)
      throw new Error('This candidate is already linked to the canonical identity.');
    const sourceTable = sourceContactId ? 'sales_os_contacts' : 'sales_os_accounts';
    const sourceId = sourceContactId ?? sourceAccountId;
    const targetId = targetContactId ?? targetAccountId;
    const { data: sourceSnapshot, error: sourceError } = await client
      .from(sourceTable)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', sourceId)
      .single();
    if (sourceError) throw sourceError;
    const targetSnapshot = await client
      .from(sourceTable)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', targetId)
      .single();
    if (targetSnapshot.error) throw targetSnapshot.error;
    const identities = [sourceSnapshot, targetSnapshot.data]
      .map((record) =>
        record && typeof record === 'object'
          ? (record as Record<string, unknown>)
          : null,
      )
      .map((record) =>
        String(record?.professional_email ?? '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    if (identities.length) {
      const { data: suppressed, error: suppressionError } = await client
        .from('sales_os_suppression_records')
        .select('identifier')
        .eq('tenant_id', tenantId)
        .eq('product_id', member.product_id)
        .eq('channel', 'email')
        .eq('active', true)
        .in('identifier', identities);
      if (suppressionError) throw suppressionError;
      if ((suppressed ?? []).length > 0)
        throw new Error('Identity merge blocked because one identity is suppressed.');
    }
    if (sourceContactId) {
      await client
        .from('sales_os_contacts')
        .update({
          identity_state: 'merged',
          merged_into_contact_id: targetContactId,
          updated_by: auth.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('id', sourceContactId);
      await client
        .from('sales_os_audience_members')
        .update({ contact_id: targetContactId, updated_by: auth.user.id })
        .eq('tenant_id', tenantId)
        .eq('contact_id', sourceContactId);
      await client
        .from('sales_os_opportunities')
        .update({ contact_id: targetContactId, updated_by: auth.user.id })
        .eq('tenant_id', tenantId)
        .eq('contact_id', sourceContactId);
      await client
        .from('sales_os_engagements')
        .update({ contact_id: targetContactId, updated_by: auth.user.id })
        .eq('tenant_id', tenantId)
        .eq('contact_id', sourceContactId);
    } else {
      await client
        .from('sales_os_accounts')
        .update({
          identity_state: 'merged',
          merged_into_account_id: targetAccountId,
          updated_by: auth.user.id,
        })
        .eq('tenant_id', tenantId)
        .eq('id', sourceAccountId);
      await client
        .from('sales_os_audience_members')
        .update({ account_id: targetAccountId, updated_by: auth.user.id })
        .eq('tenant_id', tenantId)
        .eq('account_id', sourceAccountId);
      await client
        .from('sales_os_opportunities')
        .update({ account_id: targetAccountId, updated_by: auth.user.id })
        .eq('tenant_id', tenantId)
        .eq('account_id', sourceAccountId);
    }
    const mergeKey = `${candidate.product_id}:${sourceId}:${targetId}`;
    const { data: merge, error: insertError } = await client
      .from('sales_os_identity_merges')
      .insert({
        tenant_id: tenantId,
        product_id: candidate.product_id,
        member_id: candidate.member_id,
        candidate_id: candidate.id,
        source_account_id: sourceAccountId,
        source_contact_id: sourceContactId,
        target_account_id: targetAccountId,
        target_contact_id: targetContactId,
        confidence: candidate.confidence,
        merge_basis: candidate.match_basis,
        provenance: candidate.provenance,
        source_snapshot: sourceSnapshot,
        target_snapshot: targetSnapshot.data,
        conflict_resolution: { rule: 'canonical_target_preserved' },
        merge_key: mergeKey,
        status: 'approved',
        approved_by: auth.user.id,
        approved_at: new Date().toISOString(),
        review_notes: body.reviewNotes ?? null,
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select()
      .single();
    if (insertError) throw insertError;
    await client
      .from('sales_os_identity_candidates')
      .update({
        status: 'accepted',
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: body.reviewNotes ?? null,
        updated_by: auth.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', candidate.id);
    await appendIdentityEvent(
      candidate.product_id,
      {
        mergeId: merge.id,
        action: 'approved',
        candidateId: candidate.id,
        sourceAccountId,
        sourceContactId,
        targetAccountId,
        targetContactId,
        confidence: candidate.confidence,
      },
      auth.user.id,
    );
    return json({ data: merge });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Identity review failed.' },
      400,
    );
  }
});

async function appendIdentityEvent(
  productId: string,
  dimensions: Record<string, unknown>,
  actor: string,
) {
  const { error } = await client
    .from('sales_os_events')
    .upsert(
      {
        tenant_id: tenantId,
        product_id: productId,
        event_type: 'identity_merge',
        dimensions,
        idempotency_key: `identity-merge:${String(dimensions.mergeId)}:${String(dimensions.action)}`,
        created_by: actor,
      },
      { onConflict: 'tenant_id,product_id,idempotency_key', ignoreDuplicates: true },
    );
  if (error) throw error;
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

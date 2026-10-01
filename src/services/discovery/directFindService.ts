import type { SupabaseClient } from '@supabase/supabase-js';

import { executeCapabilityWithBudget } from '../../providers/guarded';
import type { ProviderExecutionContext } from '../../providers/runner';
import type { ProviderRunRecorder } from '../../providers/runs';
import { ProviderRegistry } from '../../providers/registry';
import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import {
  DirectAccountCandidateSchema,
  DirectContactCandidateSchema,
  DirectPersonCandidateSchema,
  buildDirectAccountInsert,
  buildDirectContactInsert,
  type DirectAccountCandidate,
  type DirectContactCandidate,
  type DirectPersonCandidate,
} from './direct';
import { assertApprovedFindRoute } from './routeGuard';

type DirectFindContext = {
  productId: string;
  audienceId: string;
  routeId: string;
  jobId: string;
  actor: string;
  estimatedCost: number;
  productContext: Record<string, unknown>;
  audienceContext: Record<string, unknown>;
};

export async function runDirectFind(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: DirectFindContext,
) {
  await assertApprovedFindRoute(client, input);
  const context = (capability: string): ProviderExecutionContext => ({
    productId: input.productId,
    jobId: input.jobId,
    estimatedCost: input.estimatedCost,
    actor: input.actor,
    requestReference: `${input.jobId}:${capability}`,
  });

  const accountResult = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'findCompany',
    { product: input.productContext, audience: input.audienceContext },
    context('findCompany'),
  );
  if (accountResult.status !== 'executed' || !accountResult.result.success) {
    return { accountResult, accounts: [], contacts: [] };
  }

  const accounts = parseMany(accountResult.result.data, DirectAccountCandidateSchema);
  const persistedAccounts: Array<{ id: string; candidate: DirectAccountCandidate }> =
    [];
  for (const account of accounts) {
    const { data, error } = await client
      .from('sales_os_accounts')
      .upsert(
        buildDirectAccountInsert({
          productId: input.productId,
          candidate: account,
          jobId: input.jobId,
          provider: accountResult.result.provider,
          actor: input.actor,
        }),
        { onConflict: 'tenant_id,product_id,normalized_domain' },
      )
      .select()
      .single();
    if (error) throw error;
    persistedAccounts.push({ id: data.id, candidate: account });
  }

  const contacts: Array<{
    accountId: string;
    id: string;
    person: DirectPersonCandidate;
    contact?: DirectContactCandidate;
  }> = [];
  for (const persistedAccount of persistedAccounts) {
    const personResult = await executeCapabilityWithBudget(
      client,
      registry,
      recorder,
      'findPerson',
      {
        product: input.productContext,
        audience: input.audienceContext,
        account: persistedAccount.candidate,
      },
      context(`findPerson:${persistedAccount.id}`),
    );
    if (personResult.status !== 'executed' || !personResult.result.success) continue;
    const people = parseMany(personResult.result.data, DirectPersonCandidateSchema);
    for (const person of people) {
      let contact: DirectContactCandidate | undefined;
      const contactResult = await executeCapabilityWithBudget(
        client,
        registry,
        recorder,
        'findContact',
        { account: persistedAccount.candidate, person },
        context(`findContact:${persistedAccount.id}:${person.fullName}`),
      );
      if (contactResult.status === 'executed' && contactResult.result.success) {
        contact = DirectContactCandidateSchema.safeParse(
          contactResult.result.data,
        ).data;
      }
      const { data, error } = await client
        .from('sales_os_contacts')
        .insert(
          buildDirectContactInsert({
            productId: input.productId,
            accountId: persistedAccount.id,
            person,
            contact,
            jobId: input.jobId,
            provider: contactResult.result?.provider ?? personResult.result.provider,
            actor: input.actor,
          }),
        )
        .select()
        .single();
      if (error) throw error;
      contacts.push({ accountId: persistedAccount.id, id: data.id, person, contact });
    }
  }
  return { accountResult, accounts: persistedAccounts, contacts };
}

export async function verifyDirectContact(
  client: SupabaseClient,
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  input: {
    productId: string;
    jobId: string;
    contactId: string;
    email: string;
    estimatedCost: number;
    actor: string;
  },
) {
  const result = await executeCapabilityWithBudget(
    client,
    registry,
    recorder,
    'verifyContact',
    { email: input.email },
    {
      productId: input.productId,
      jobId: input.jobId,
      estimatedCost: input.estimatedCost,
      actor: input.actor,
      requestReference: `verifyContact:${input.contactId}`,
    },
  );
  if (result.status !== 'executed' || !result.result.success) return result;
  const parsed = DirectContactCandidateSchema.parse(result.result.data);
  const { data, error } = await client
    .from('sales_os_contacts')
    .update({
      professional_email: input.email,
      email_verification_status: parsed.verificationStatus,
      email_verification_provider:
        parsed.verificationProvider ?? result.result.provider,
      last_verified_at: new Date().toISOString(),
      source_evidence: parsed.evidence,
      updated_by: input.actor,
    })
    .eq('tenant_id', SALES_OS_TENANT_ID)
    .eq('product_id', input.productId)
    .eq('id', input.contactId)
    .select()
    .single();
  if (error) throw error;
  return { ...result, contact: data };
}

function parseMany<T>(
  value: unknown,
  schema: { safeParse(input: unknown): { success: boolean; data?: T } },
): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success && parsed.data ? [parsed.data] : [];
  });
}

import { supabaseBrowserClient } from '../../lib/supabase/browser';

export type ActivationMember = {
  id: string;
  account_id: string | null;
  contact_id: string | null;
  external_entity_key: string | null;
  status: string;
  suppression_state: string;
  consent_state: string;
  quality_state?: string | null;
};

export type ActivationPreview = {
  eligible: ActivationMember[];
  blocked: Array<{ member: ActivationMember; reasons: string[] }>;
};

export function buildActivationPreview(members: ActivationMember[]): ActivationPreview {
  const eligible: ActivationMember[] = [];
  const blocked: ActivationPreview['blocked'] = [];
  for (const member of members) {
    const reasons: string[] = [];
    if (member.status !== 'ready') reasons.push(`status:${member.status}`);
    if (member.quality_state && member.quality_state !== 'ready')
      reasons.push(`quality:${member.quality_state}`);
    if (member.suppression_state !== 'clear') reasons.push('suppressed_or_unchecked');
    if (['restricted', 'revoked'].includes(member.consent_state))
      reasons.push('consent_blocked');
    if (reasons.length) blocked.push({ member, reasons });
    else eligible.push(member);
  }
  return { eligible, blocked };
}

export async function activateAudience(input: Record<string, unknown>) {
  const { data, error } = await supabaseBrowserClient.functions.invoke(
    'sales_os-activation',
    { body: input },
  );
  if (error) throw error;
  return data;
}

type GroundingRecord = Record<string, unknown>;

export function buildCopyGrounding(
  product: GroundingRecord,
  profile: GroundingRecord,
  audience: GroundingRecord,
  contact: GroundingRecord | null,
  channel: string,
) {
  return {
    productName: String(product.name ?? '').trim(),
    channel,
    approvedCapabilities: Array.isArray(profile.core_capabilities)
      ? profile.core_capabilities
      : [],
    approvedUseCases: Array.isArray(profile.primary_use_cases)
      ? profile.primary_use_cases
      : [],
    audienceName: String(audience.name ?? '').trim(),
    verifiedRecipient: contact
      ? {
          fullName: contact.full_name ?? null,
          title: contact.title ?? null,
          emailVerificationStatus: contact.email_verification_status ?? null,
        }
      : null,
    firstTouchRules: [
      'Introduce the product by its productName in the first-touch message.',
      'Describe approved capabilities as features of productName, never as tools the recipient already has or uses.',
      'Never write your [feature], you use [feature], you have [feature], or equivalent unless the verified recipient evidence explicitly says they use it.',
      'Use recipient-specific claims only when present in verifiedRecipient or opportunityEvidence.',
      'Do not invent prior conversations, shared tools, subscriptions, alerts, reports, or workflows.',
      'If a capability has a branded internal feature name, introduce it as a capability of productName before referring to it.',
    ],
  };
}

export function assertRecipientSafeDraft(
  draftContent: string,
  productName: string,
  profile: GroundingRecord,
  channel: string,
) {
  if (!['email', 'professional_social'].includes(channel)) return;
  const lowerDraft = draftContent.toLowerCase();
  const productTokens = productName
    .split(/[^a-z0-9]+/i)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3);
  if (!productTokens.some((token) => lowerDraft.includes(token))) {
    throw new Error(
      'Generated first-touch copy did not introduce the product by name. The draft was rejected before save.',
    );
  }

  const profileText = Object.values(profile)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const namedTerms = new Set<string>();
  for (const match of profileText.matchAll(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g)) {
    const term = match[0].toLowerCase();
    if (!productTokens.includes(term)) namedTerms.add(term);
  }
  for (const term of namedTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const unsupportedOwnership = new RegExp(
      `\\b(?:your|you use|you have|you already use|your team's?)\\s+(?:the\\s+)?${escaped}\\b`,
      'i',
    );
    if (unsupportedOwnership.test(draftContent)) {
      throw new Error(
        `Generated copy assumes the recipient already uses an internal product capability (${term}). The draft was rejected before save.`,
      );
    }
  }
}

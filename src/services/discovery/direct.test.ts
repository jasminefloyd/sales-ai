import { describe, expect, it } from 'vitest';

import {
  buildDirectAccountInsert,
  buildDirectContactInsert,
  normalizeCompanyDomain,
  qualifyDirectCandidate,
} from './direct';

const account = {
  name: 'Acme Inc',
  domain: 'https://www.acme.example/path',
  websiteUrl: 'https://acme.example',
  companyContext: {},
  evidence: [
    {
      excerpt: 'Company has the stated operating problem.',
      sourceType: 'company_site',
    },
  ],
};
const person = {
  fullName: 'Jordan Lee',
  title: 'VP Operations',
  evidence: [
    {
      excerpt: 'Jordan owns the relevant operating function.',
      sourceType: 'professional',
    },
  ],
};

describe('direct discovery', () => {
  it('normalizes company domains and retains stage provenance', () => {
    expect(normalizeCompanyDomain('https://www.acme.example/path')).toBe(
      'acme.example',
    );
    const insert = buildDirectAccountInsert({
      productId: 'product-1',
      candidate: account,
      jobId: 'job-1',
      provider: 'exa',
      actor: 'user-1',
    });
    expect(insert.domain).toBe('acme.example');
    expect(insert.source_evidence[0]).toMatchObject({
      jobId: 'job-1',
      stage: 'account_discovery',
    });
  });

  it('retains a person when no verified email is available', () => {
    const insert = buildDirectContactInsert({
      productId: 'product-1',
      accountId: 'account-1',
      person,
      jobId: 'job-1',
      provider: 'exa',
      actor: 'user-1',
    });
    expect(insert.professional_email).toBeNull();
    expect(insert.email_verification_status).toBe('unknown');
  });

  it('blocks suppressed contacts while allowing manual review for invalid email', () => {
    const result = qualifyDirectCandidate({
      productId: 'product-1',
      audienceStatus: 'approved',
      routeStatus: 'approved',
      account,
      person,
      contact: { verificationStatus: 'invalid', evidence: [] },
      duplicateContact: false,
      duplicateOpportunity: false,
      suppressed: true,
      minimumEvidenceScore: 'low',
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('contact_suppressed');

    const manualReview = qualifyDirectCandidate({
      productId: 'product-1',
      audienceStatus: 'approved',
      routeStatus: 'approved',
      account,
      person,
      contact: { verificationStatus: 'invalid', evidence: [] },
      duplicateContact: false,
      duplicateOpportunity: false,
      suppressed: false,
      minimumEvidenceScore: 'low',
    });
    expect(manualReview.qualified).toBe(true);
    expect(manualReview.emailReady).toBe(false);
  });
});

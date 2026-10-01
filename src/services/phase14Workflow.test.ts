import { describe, expect, it } from 'vitest';

import { evaluateBudget } from './budget/budget';
import { isSuppressed } from './contacts/suppression';
import { evaluatePreSend } from './engagement/guards';
import { buildLearningProposal } from './learning/learningService';
import { assertValidStateTransition } from './state/transitions';
import { qualifyDirectCandidate } from './discovery/direct';
import { aggregateLearningMetrics } from './learning/learningService';

describe('Phase 14 deterministic workflow harness', () => {
  it('enforces the guarded social path before publication', () => {
    assertValidStateTransition('product', 'draft', 'analyzing');
    assertValidStateTransition('audience', 'proposed', 'approved');
    assertValidStateTransition('engagement', 'drafted', 'awaiting_approval');
    assertValidStateTransition('engagement', 'awaiting_approval', 'approved');
    assertValidStateTransition('engagement', 'approved', 'queued');
    expect(
      evaluateBudget({
        monthlySpend: 0,
        activeReservations: 0,
        requestedCost: 1,
        monthlyCap: 1,
        perRunCap: null,
      }).allowed,
    ).toBe(true);
  });

  it('blocks a suppressed contact for one product without cross-product leakage', () => {
    const suppression = [
      {
        tenant_id: 'sales_os',
        product_id: 'product-a',
        channel: 'email',
        identifier: 'lead@example.com',
        active: true,
      },
    ];
    expect(isSuppressed(suppression, 'product-a', 'email', 'lead@example.com')).toBe(
      true,
    );
    expect(isSuppressed(suppression, 'product-b', 'email', 'lead@example.com')).toBe(
      false,
    );
    expect(
      evaluatePreSend({
        productStatus: 'active',
        opportunityStatus: 'approved',
        engagementStatus: 'approved',
        contactEmail: 'lead@example.com',
        emailVerificationStatus: 'valid',
        suppressionRecords: suppression,
        productId: 'product-a',
        priorEngagements: [],
        sendingLimitReached: false,
        budgetAllowed: true,
        gmailEnabled: true,
      }),
    ).toEqual({ allowed: false, reason: 'contact_suppressed' });
  });

  it('keeps learning changes proposed until approval', () => {
    const proposal = buildLearningProposal({
      productId: 'product-1',
      actor: 'user-1',
      recommendation: {
        observation: 'Responses improved.',
        supportingEvidence: [{ event: 'response_received' }],
        sampleSize: 10,
        confidence: 'high',
        targetPhase: 'engage',
        recommendedChange: {
          targetKey: 'cta_preference',
          targetEntityId: null,
          before: 'Learn',
          after: 'Demo',
        },
      },
    });
    expect(proposal.status).toBe('proposed');
  });

  it('covers the direct path through enrichment qualification and verified evidence', () => {
    const decision = qualifyDirectCandidate({
      productId: 'product-1',
      audienceStatus: 'active',
      routeStatus: 'active',
      account: {
        name: 'Acme',
        domain: 'acme.example',
        websiteUrl: 'https://acme.example',
        companyContext: {},
        evidence: [{ excerpt: 'Company evidence', sourceType: 'company_site' }],
      },
      person: {
        fullName: 'Jordan Smith',
        title: 'VP Sales',
        evidence: [{ excerpt: 'Role evidence', sourceType: 'professional_profile' }],
      },
      contact: {
        professionalEmail: 'jordan@acme.example',
        verificationStatus: 'valid',
        verificationProvider: 'test',
        evidence: [{ excerpt: 'Verified email', sourceType: 'email_verifier' }],
      },
      duplicateContact: false,
      duplicateOpportunity: false,
      suppressed: false,
    });
    expect(decision).toMatchObject({
      qualified: true,
      evidenceScore: 'high',
      emailReady: true,
    });
  });

  it('covers structured learning aggregation dimensions', () => {
    const metrics = aggregateLearningMetrics([
      {
        event_type: 'response_received',
        audience_id: 'aud-1',
        source_id: 'src-1',
        signal_id: 'sig-1',
        dimensions: {
          route: 'direct',
          contactRole: 'vp_sales',
          messageAngle: 'roi',
          cta: 'demo',
          followUpCadence: '3d',
          provider: 'gmail',
        },
      },
    ]);
    expect(metrics.breakdowns).toMatchObject({
      audience: { 'aud-1': 1 },
      route: { direct: 1 },
      source: { 'src-1': 1 },
      signal: { 'sig-1': 1 },
      contactRole: { vp_sales: 1 },
      messageAngle: { roi: 1 },
      cta: { demo: 1 },
      followUpCadence: { '3d': 1 },
      provider: { gmail: 1 },
    });
  });
});

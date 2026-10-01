import { describe, expect, it } from 'vitest';

import {
  buildEnrichmentSnapshot,
  mergeNonEmptyFields,
  missingContactFields,
} from './enrichmentService';

describe('enrichment lifecycle rules', () => {
  it('does not mark an unverified contact activation-ready', () => {
    const result = buildEnrichmentSnapshot({
      entity: 'contact',
      record: {
        full_name: 'Taylor Buyer',
        title: 'VP Sales',
        professional_email: 'taylor@example.com',
        email_verification_status: 'unknown',
        last_enriched_at: new Date().toISOString(),
      },
      memberStatus: 'needs_enrichment',
      consentState: 'unknown',
      suppressionState: 'clear',
    });
    expect(result.activationReady).toBe(false);
    expect(result.missingFields).toContain('verified_email');
  });

  it('treats a complete valid contact as ready when it is not blocked', () => {
    const result = buildEnrichmentSnapshot({
      entity: 'contact',
      record: {
        full_name: 'Taylor Buyer',
        title: 'VP Sales',
        professional_email: 'taylor@example.com',
        email_verification_status: 'valid',
        last_enriched_at: new Date().toISOString(),
      },
      memberStatus: 'discovered',
      consentState: 'unknown',
      suppressionState: 'clear',
    });
    expect(result.activationReady).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('preserves existing values when a provider returns null or blank fields', () => {
    expect(
      mergeNonEmptyFields(
        { name: 'Existing Co', industry: 'Software' },
        { name: '', industry: null, domain: 'existing.example' },
      ),
    ).toEqual({
      name: 'Existing Co',
      industry: 'Software',
      domain: 'existing.example',
    });
  });

  it('requires email verification separately from email presence', () => {
    expect(
      missingContactFields({
        full_name: 'Taylor',
        title: 'Buyer',
        professional_email: 'taylor@example.com',
        email_verification_status: 'risky',
      }),
    ).toEqual(['verified_email']);
  });
});

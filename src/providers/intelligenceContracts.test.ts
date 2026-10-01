import { describe, expect, it } from 'vitest';

import {
  IntelligenceRequestSchemas,
  NormalizedProviderResponseSchema,
  normalizeProviderError,
} from './intelligenceContracts';

describe('provider-neutral intelligence contracts', () => {
  it('defines a normalized request schema for every planned capability', () => {
    const capabilities = [
      'find_company',
      'find_contact',
      'enrich_company',
      'enrich_contact',
      'verify_email',
      'resolve_identity',
      'find_intent_signal',
      'export_audience',
    ] as const;
    for (const capability of capabilities) {
      expect(
        IntelligenceRequestSchemas[capability].safeParse({
          productId: '123e4567-e89b-12d3-a456-426614174000',
          input: { request: capability },
        }).success,
      ).toBe(true);
    }
  });

  it('classifies retryable and non-retryable provider errors deterministically', () => {
    expect(
      normalizeProviderError({ providerStatus: 429, message: 'rate limited' }),
    ).toMatchObject({
      category: 'rate_limit',
      retryable: true,
      policyFailure: false,
    });
    expect(
      normalizeProviderError({ providerStatus: 403, message: 'forbidden' }),
    ).toMatchObject({
      category: 'authorization',
      retryable: false,
      policyFailure: false,
    });
    expect(
      normalizeProviderError({ category: 'policy', message: 'blocked' }),
    ).toMatchObject({
      category: 'policy',
      retryable: false,
      policyFailure: true,
    });
  });

  it('rejects normalized responses without provenance timestamps and contract fields', () => {
    expect(
      NormalizedProviderResponseSchema.safeParse({
        success: true,
        providerKey: 'mock',
        capability: 'find_company',
        records: [],
      }).success,
    ).toBe(false);
  });
});

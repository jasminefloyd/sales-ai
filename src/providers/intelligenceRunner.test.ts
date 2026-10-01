import { describe, expect, it } from 'vitest';

import { createMockIntelligenceProvider } from './adapters/mockIntelligence';
import {
  failedProviderResponse,
  type IntelligenceCapability,
  type NormalizedProviderResponse,
} from './intelligenceContracts';
import { IntelligenceProviderRegistry } from './intelligenceRegistry';
import {
  executeIntelligenceCapability,
  InMemoryIntelligenceRunRecorder,
} from './intelligenceRunner';

const request = {
  productId: '123e4567-e89b-12d3-a456-426614174000',
  input: { query: 'operators' },
};

function success(
  capability: IntelligenceCapability,
  providerKey: string,
): NormalizedProviderResponse {
  const now = new Date().toISOString();
  return {
    success: true,
    providerKey,
    capability,
    records: [{ name: 'Example Company' }],
    evidence: [],
    externalIds: {},
    confidence: 0.8,
    observedAt: now,
    freshnessAt: now,
    cost: 0.01,
    latencyMs: 1,
    error: null,
  };
}

describe('provider-neutral intelligence runner', () => {
  it('selects by priority and falls back on retryable provider failure', async () => {
    const registry = new IntelligenceProviderRegistry();
    registry.register({
      providerId: 'first',
      provider: createMockIntelligenceProvider({
        providerKey: 'first',
        capabilities: ['find_company'],
        execute: async () =>
          failedProviderResponse({
            providerKey: 'first',
            capability: 'find_company',
            error: {
              category: 'rate_limit',
              code: 'rate_limited',
              message: 'retry',
              retryable: true,
              policyFailure: false,
            },
          }),
      }),
      capability: 'find_company',
      enabled: true,
      qualified: true,
      healthStatus: 'healthy',
      priority: 10,
      timeoutMs: 100,
    });
    registry.register({
      providerId: 'second',
      provider: createMockIntelligenceProvider({
        providerKey: 'second',
        capabilities: ['find_company'],
        execute: async () => success('find_company', 'second'),
      }),
      capability: 'find_company',
      enabled: true,
      qualified: true,
      healthStatus: 'healthy',
      priority: 20,
      timeoutMs: 100,
    });
    const recorder = new InMemoryIntelligenceRunRecorder();
    const result = await executeIntelligenceCapability(
      registry,
      recorder,
      'find_company',
      request,
      { productId: request.productId, actor: 'test', estimatedCost: 0 },
    );
    expect(result.providerKey).toBe('second');
    expect(recorder.runs).toHaveLength(2);
    expect(recorder.runs[1]?.fallbackUsed).toBe(true);
  });

  it('does not fall back after a policy failure', async () => {
    const registry = new IntelligenceProviderRegistry();
    registry.register({
      providerId: 'policy',
      provider: createMockIntelligenceProvider({
        providerKey: 'policy',
        capabilities: ['verify_email'],
        execute: async () =>
          failedProviderResponse({
            providerKey: 'policy',
            capability: 'verify_email',
            error: {
              category: 'policy',
              code: 'restricted',
              message: 'not permitted',
              retryable: false,
              policyFailure: true,
            },
          }),
      }),
      capability: 'verify_email',
      enabled: true,
      qualified: true,
      healthStatus: 'healthy',
      priority: 1,
      timeoutMs: 100,
    });
    registry.register({
      providerId: 'fallback',
      provider: createMockIntelligenceProvider({
        providerKey: 'fallback',
        capabilities: ['verify_email'],
        execute: async () => success('verify_email', 'fallback'),
      }),
      capability: 'verify_email',
      enabled: true,
      qualified: true,
      healthStatus: 'healthy',
      priority: 2,
      timeoutMs: 100,
    });
    const recorder = new InMemoryIntelligenceRunRecorder();
    const result = await executeIntelligenceCapability(
      registry,
      recorder,
      'verify_email',
      request,
      { productId: request.productId, actor: 'test', estimatedCost: 0 },
    );
    expect(result.error?.category).toBe('policy');
    expect(recorder.runs).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';

import type { CapabilityProvider, CapabilityResult } from './capabilities';
import { ProviderRegistry } from './registry';
import { buildReasoningInput, executeCapability } from './runner';
import type { ProviderRunRecorder } from './runs';

function provider(
  providerKey: string,
  result: CapabilityResult<unknown>,
): CapabilityProvider {
  return {
    providerKey,
    capabilities: ['reasoning'],
    execute: async <T>() => result as CapabilityResult<T>,
  };
}

function recorder(): ProviderRunRecorder & { failed: string[]; succeeded: string[] } {
  const failed: string[] = [];
  const succeeded: string[] = [];
  return {
    failed,
    succeeded,
    async start(input) {
      return `${input.providerId}-run`;
    },
    async succeed(runId) {
      succeeded.push(runId);
    },
    async fail(runId) {
      failed.push(runId);
    },
  };
}

describe('provider execution fallback', () => {
  it('adds the non-negotiable evidence and guardrail policy to reasoning input', () => {
    expect(buildReasoningInput({ task: 'test' }).salesOsPolicy).toEqual({
      observedEvidenceRequired: true,
      distinguishObservedEvidenceFromInference: true,
      noFabricatedContactData: true,
      deterministicGuardsRemainAuthoritative: true,
    });
  });

  it('falls back from a retryable reasoning failure to the next provider', async () => {
    const registry = new ProviderRegistry();
    registry.register({
      providerId: 'openai',
      provider: provider('openai', {
        provider: 'openai',
        success: false,
        data: null,
        cost: 0,
        latencyMs: 1,
        error: { code: 'timeout', message: 'timed out', retryable: true },
      }),
      capability: 'reasoning',
      enabled: true,
      qualified: true,
      priority: 1,
    });
    registry.register({
      providerId: 'anthropic',
      provider: provider('anthropic', {
        provider: 'anthropic',
        success: true,
        data: { answer: 'fallback' },
        cost: 0.01,
        latencyMs: 1,
      }),
      capability: 'reasoning',
      enabled: true,
      qualified: true,
      priority: 2,
    });
    const runRecorder = recorder();

    const result = await executeCapability(
      registry,
      runRecorder,
      'reasoning',
      { task: 'test' },
      { productId: 'product-1', estimatedCost: 0.01, actor: 'user-1' },
    );

    expect(result).toMatchObject({ provider: 'anthropic', success: true });
    expect(runRecorder.failed).toEqual(['openai-run']);
    expect(runRecorder.succeeded).toEqual(['anthropic-run']);
  });

  it('does not fallback when a provider reports a policy failure', async () => {
    const registry = new ProviderRegistry();
    registry.register({
      providerId: 'openai',
      provider: provider('openai', {
        provider: 'openai',
        success: false,
        data: null,
        cost: 0,
        latencyMs: 1,
        error: {
          code: 'policy',
          message: 'blocked',
          retryable: true,
          policyFailure: true,
        },
      }),
      capability: 'reasoning',
      enabled: true,
      qualified: true,
      priority: 1,
    });
    registry.register({
      providerId: 'anthropic',
      provider: provider('anthropic', {
        provider: 'anthropic',
        success: true,
        data: { answer: 'must not run' },
        cost: 0,
        latencyMs: 1,
      }),
      capability: 'reasoning',
      enabled: true,
      qualified: true,
      priority: 2,
    });
    const runRecorder = recorder();

    const result = await executeCapability(
      registry,
      runRecorder,
      'reasoning',
      { task: 'test' },
      { productId: 'product-1', estimatedCost: 0.01, actor: 'user-1' },
    );

    expect(result.provider).toBe('openai');
    expect(result.success).toBe(false);
    expect(runRecorder.succeeded).toEqual([]);
  });
});

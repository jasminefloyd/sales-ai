import {
  failedProviderResponse,
  type IntelligenceCapability,
  type IntelligenceProvider,
  type IntelligenceRequest,
  type NormalizedProviderResponse,
  normalizeProviderError,
} from '../intelligenceContracts';

export function createMockIntelligenceProvider(input: {
  providerKey?: string;
  capabilities: readonly IntelligenceCapability[];
  execute?: (
    capability: IntelligenceCapability,
    request: IntelligenceRequest,
  ) => Promise<NormalizedProviderResponse>;
}): IntelligenceProvider {
  const providerKey = input.providerKey ?? 'mock';
  return {
    providerKey,
    capabilities: input.capabilities,
    async execute(capability, request) {
      if (input.execute) return input.execute(capability, request);
      return failedProviderResponse({
        providerKey,
        capability,
        error: normalizeProviderError({
          category: 'provider_unavailable',
          code: 'mock_not_implemented',
          message: `Mock provider ${providerKey} has no response configured.`,
        }),
      });
    },
  };
}

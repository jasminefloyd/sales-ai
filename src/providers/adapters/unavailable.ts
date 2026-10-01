import {
  capabilityResult,
  type CapabilityInput,
  type CapabilityName,
  type CapabilityProvider,
} from '../capabilities';

export function createUnavailableAdapter(
  providerKey: string,
  capabilities: readonly CapabilityName[],
): CapabilityProvider {
  return {
    providerKey,
    capabilities,
    async execute<T>(capability: CapabilityName, input: CapabilityInput) {
      void input;
      return capabilityResult<T>({
        provider: providerKey,
        success: false,
        data: null,
        cost: 0,
        error: {
          code: 'adapter_not_configured',
          message: `${providerKey} adapter for ${capability} is not configured for execution.`,
          retryable: true,
        },
      });
    },
  };
}

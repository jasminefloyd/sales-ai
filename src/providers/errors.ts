import type { ProviderError } from './capabilities';

export class ProviderExecutionError extends Error {
  constructor(
    message: string,
    public readonly details: ProviderError,
  ) {
    super(message);
    this.name = 'ProviderExecutionError';
  }
}

export function isFallbackEligible(error: ProviderError | undefined): boolean {
  return Boolean(error && error.retryable && !error.policyFailure);
}

export type CapabilityName =
  | 'searchWeb'
  | 'scrapePage'
  | 'searchCommunity'
  | 'findCompany'
  | 'findPerson'
  | 'findContact'
  | 'verifyContact'
  | 'sendEmail'
  | 'publishResponse'
  | 'getProductEvent'
  | 'getRevenueEvent'
  | 'reasoning';

export type CapabilityInput = Record<string, unknown>;

export type ProviderError = {
  code: string;
  message: string;
  retryable: boolean;
  policyFailure?: boolean;
};

export type CapabilityResult<T = unknown> = {
  provider: string;
  success: boolean;
  data: T | null;
  evidence?: unknown[];
  externalIds?: Record<string, string>;
  cost: number;
  latencyMs: number;
  error?: ProviderError;
};

export type CapabilityProvider = {
  providerKey: string;
  modelIdentifier?: string;
  capabilities: readonly CapabilityName[];
  execute<T = unknown>(
    capability: CapabilityName,
    input: CapabilityInput,
  ): Promise<CapabilityResult<T>>;
};

export function capabilityResult<T>(
  result: Omit<CapabilityResult<T>, 'latencyMs'> & { latencyMs?: number },
): CapabilityResult<T> {
  return { latencyMs: 0, ...result };
}

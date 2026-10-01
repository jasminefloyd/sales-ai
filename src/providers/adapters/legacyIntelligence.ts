import type { CapabilityName, CapabilityProvider } from '../capabilities';
import {
  failedProviderResponse,
  type IntelligenceCapability,
  type IntelligenceProvider,
  type IntelligenceRequest,
} from '../intelligenceContracts';

const capabilityMap: Partial<Record<IntelligenceCapability, CapabilityName>> = {
  find_company: 'findCompany',
  find_contact: 'findContact',
  verify_email: 'verifyContact',
};

export function createLegacyIntelligenceAdapter(
  legacy: CapabilityProvider,
  capabilities: readonly IntelligenceCapability[],
): IntelligenceProvider {
  return {
    providerKey: legacy.providerKey,
    modelIdentifier: legacy.modelIdentifier,
    capabilities,
    async execute(capability: IntelligenceCapability, request: IntelligenceRequest) {
      const legacyCapability = capabilityMap[capability];
      if (!legacyCapability || !legacy.capabilities.includes(legacyCapability)) {
        return failedProviderResponse({
          providerKey: legacy.providerKey,
          capability,
          error: {
            category: 'provider_unavailable',
            code: 'capability_not_supported',
            message: `${legacy.providerKey} does not support ${capability}.`,
            retryable: false,
            policyFailure: false,
          },
        });
      }
      const result = await legacy.execute(legacyCapability, request.input);
      const now = new Date().toISOString();
      const records = Array.isArray(result.data)
        ? result.data.filter(isRecord)
        : isRecord(result.data)
          ? [result.data]
          : [];
      const evidence = (result.evidence ?? []).flatMap((value) => {
        if (!isRecord(value)) return [];
        return [
          {
            sourceSystem: legacy.providerKey,
            sourceRecordId:
              typeof value.sourceRecordId === 'string' ? value.sourceRecordId : null,
            url: typeof value.url === 'string' ? value.url : null,
            excerpt: typeof value.excerpt === 'string' ? value.excerpt : null,
            observedAt: now,
          },
        ];
      });
      return {
        success: result.success,
        providerKey: legacy.providerKey,
        capability,
        records,
        evidence,
        externalIds: result.externalIds ?? {},
        confidence: result.success ? 1 : 0,
        observedAt: now,
        freshnessAt: now,
        cost: result.cost,
        latencyMs: result.latencyMs,
        error: result.error
          ? {
              category: result.error.policyFailure ? 'policy' : 'unknown',
              code: result.error.code,
              message: result.error.message,
              retryable: result.error.retryable,
              policyFailure: Boolean(result.error.policyFailure),
            }
          : null,
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

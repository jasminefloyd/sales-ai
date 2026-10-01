import type { CapabilityInput, CapabilityName, CapabilityResult } from './capabilities';
import { isFallbackEligible } from './errors';
import { ProviderRegistry, supportsFallback } from './registry';
import type { ProviderRunRecorder } from './runs';

export const SALES_OS_PROMPT_VERSION = 'sales_os_prompt_v1';

export function buildReasoningInput(input: CapabilityInput): CapabilityInput {
  return {
    ...input,
    salesOsPolicy: {
      observedEvidenceRequired: true,
      distinguishObservedEvidenceFromInference: true,
      noFabricatedContactData: true,
      deterministicGuardsRemainAuthoritative: true,
    },
  };
}

export type ProviderExecutionContext = {
  productId: string;
  jobId?: string;
  requestReference?: string;
  estimatedCost: number;
  actor: string;
  promptVersion?: string;
  modelIdentifier?: string;
};

export async function executeCapability<T>(
  registry: ProviderRegistry,
  recorder: ProviderRunRecorder,
  capability: CapabilityName,
  input: CapabilityInput,
  context: ProviderExecutionContext,
): Promise<CapabilityResult<T>> {
  const providers = registry.list(capability);
  if (providers.length === 0) {
    throw new Error(`No enabled qualified provider for capability ${capability}.`);
  }

  const candidates = supportsFallback(capability, providers)
    ? providers
    : providers.slice(0, 1);
  let lastResult: CapabilityResult<T> | undefined;

  for (const registration of candidates) {
    const startedAt = Date.now();
    const runId = await recorder.start({
      productId: context.productId,
      providerId: registration.providerId,
      capability,
      jobId: context.jobId,
      requestReference: context.requestReference,
      estimatedCost: context.estimatedCost,
      actor: context.actor,
      promptVersion: context.promptVersion ?? SALES_OS_PROMPT_VERSION,
      modelIdentifier:
        context.modelIdentifier ??
        registration.provider.modelIdentifier ??
        registration.provider.providerKey,
    });

    try {
      const providerInput =
        capability === 'reasoning' ? buildReasoningInput(input) : input;
      const result = await registration.provider.execute<T>(capability, providerInput);
      const normalizedResult = {
        ...result,
        latencyMs: result.latencyMs || Date.now() - startedAt,
      };
      if (normalizedResult.success) {
        await recorder.succeed(runId, normalizedResult);
        return normalizedResult;
      }

      await recorder.fail(runId, normalizedResult);
      lastResult = normalizedResult;
      if (
        !supportsFallback(capability, providers) ||
        !isFallbackEligible(result.error)
      ) {
        return normalizedResult;
      }
    } catch (error) {
      const normalizedError = {
        code: 'provider_exception',
        message: error instanceof Error ? error.message : 'Provider execution failed.',
        retryable: true,
      } as const;
      await recorder.fail(runId, {
        provider: registration.provider.providerKey,
        success: false,
        data: null,
        cost: 0,
        latencyMs: Date.now() - startedAt,
        error: normalizedError,
      });
      lastResult = {
        provider: registration.provider.providerKey,
        success: false,
        data: null,
        cost: 0,
        latencyMs: Date.now() - startedAt,
        error: normalizedError,
      };
      if (!supportsFallback(capability, providers)) throw error;
    }
  }

  if (lastResult) return lastResult;
  throw new Error(`Provider execution failed for capability ${capability}.`);
}

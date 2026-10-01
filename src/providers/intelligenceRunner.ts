import type { SupabaseClient } from '@supabase/supabase-js';

import {
  failedProviderResponse,
  IntelligenceRequestSchemas,
  isRetryableProviderCategory,
  normalizeProviderError,
  NormalizedProviderResponseSchema,
  type IntelligenceCapability,
  type IntelligenceProviderRegistration,
  type IntelligenceRequest,
  type NormalizedProviderResponse,
} from './intelligenceContracts';
import { IntelligenceProviderRegistry } from './intelligenceRegistry';

export type IntelligenceRunContext = {
  productId: string;
  actor: string;
  estimatedCost: number;
  requestReference?: string;
  jobId?: string;
  timeoutMs?: number;
};

export type IntelligenceRunRecorder = {
  start(input: {
    productId: string;
    providerId: string;
    capability: IntelligenceCapability;
    estimatedCost: number;
    requestReference?: string;
    jobId?: string;
    requestHash?: string;
  }): Promise<string>;
  finish(
    runId: string,
    result: NormalizedProviderResponse,
    fallbackUsed: boolean,
  ): Promise<void>;
};

export class SupabaseIntelligenceRunRecorder implements IntelligenceRunRecorder {
  constructor(private readonly client: SupabaseClient) {}

  async start(input: Parameters<IntelligenceRunRecorder['start']>[0]): Promise<string> {
    const { data, error } = await this.client
      .from('sales_os_provider_runs')
      .insert({
        tenant_id: 'sales_os',
        product_id: input.productId,
        provider_id: input.providerId,
        capability: input.capability,
        job_id: input.jobId ?? null,
        request_reference: input.requestReference ?? null,
        request_hash: input.requestHash ?? null,
        status: 'started',
        estimated_cost: input.estimatedCost,
        created_by: 'audience_intelligence',
        updated_by: 'audience_intelligence',
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async finish(
    runId: string,
    result: NormalizedProviderResponse,
    fallbackUsed: boolean,
  ): Promise<void> {
    const { error } = await this.client
      .from('sales_os_provider_runs')
      .update({
        status: result.success ? 'succeeded' : 'failed',
        completed_at: new Date().toISOString(),
        latency_ms: Math.round(result.latencyMs),
        actual_cost: result.cost,
        error_code: result.error?.code ?? null,
        error_detail: result.error?.message ?? null,
        retryable: result.error?.retryable ?? null,
        fallback_used: fallbackUsed,
        provenance: result.evidence,
        updated_by: 'audience_intelligence',
      })
      .eq('tenant_id', 'sales_os')
      .eq('id', runId);
    if (error) throw error;
  }
}

export class InMemoryIntelligenceRunRecorder implements IntelligenceRunRecorder {
  readonly runs: Array<{
    id: string;
    providerId: string;
    capability: IntelligenceCapability;
    status: 'started' | 'succeeded' | 'failed';
    fallbackUsed?: boolean;
  }> = [];

  async start(input: Parameters<IntelligenceRunRecorder['start']>[0]): Promise<string> {
    const id = `intelligence-run-${this.runs.length + 1}`;
    this.runs.push({
      id,
      providerId: input.providerId,
      capability: input.capability,
      status: 'started',
    });
    return id;
  }

  async finish(
    runId: string,
    result: NormalizedProviderResponse,
    fallbackUsed: boolean,
  ): Promise<void> {
    const run = this.runs.find((entry) => entry.id === runId);
    if (!run) return;
    run.status = result.success ? 'succeeded' : 'failed';
    run.fallbackUsed = fallbackUsed;
  }
}

export async function executeIntelligenceCapability(
  registry: IntelligenceProviderRegistry,
  recorder: IntelligenceRunRecorder,
  capability: IntelligenceCapability,
  input: IntelligenceRequest,
  context: IntelligenceRunContext,
): Promise<NormalizedProviderResponse> {
  IntelligenceRequestSchemas[capability].parse(input);
  const registrations = registry.list(capability);
  if (!registrations.length) {
    return failedProviderResponse({
      providerKey: 'sales_os',
      capability,
      error: normalizeProviderError({
        category: 'provider_unavailable',
        code: 'no_provider_available',
        message: `No enabled provider is available for ${capability}.`,
      }),
    });
  }

  let lastResult: NormalizedProviderResponse | undefined;
  for (const [index, registration] of registrations.entries()) {
    const startedAt = Date.now();
    const runId = await recorder.start({
      productId: context.productId,
      providerId: registration.providerId,
      capability,
      estimatedCost: context.estimatedCost,
      requestReference: context.requestReference,
      jobId: context.jobId,
      requestHash: requestHash(input),
    });
    const timeoutMs = context.timeoutMs ?? registration.timeoutMs;
    const result = await withTimeout(
      registration,
      capability,
      input,
      timeoutMs,
      startedAt,
    );
    const fallbackUsed = index > 0;
    await recorder.finish(runId, result, fallbackUsed);
    if (result.success) return result;
    lastResult = result;
    if (!result.error || !isRetryableProviderCategory(result.error.category))
      return result;
  }
  return lastResult as NormalizedProviderResponse;
}

async function withTimeout(
  registration: IntelligenceProviderRegistration,
  capability: IntelligenceCapability,
  input: IntelligenceRequest,
  timeoutMs: number,
  startedAt: number,
): Promise<NormalizedProviderResponse> {
  const timeout = new Promise<NormalizedProviderResponse>((resolve) => {
    setTimeout(
      () =>
        resolve(
          failedProviderResponse({
            providerKey: registration.provider.providerKey,
            capability,
            latencyMs: Date.now() - startedAt,
            error: normalizeProviderError({
              category: 'timeout',
              code: 'provider_timeout',
              message: `Provider exceeded the ${timeoutMs}ms timeout.`,
            }),
          }),
        ),
      timeoutMs,
    );
  });
  const execution = registration.provider
    .execute(capability, input)
    .then((result) => {
      const parsed = NormalizedProviderResponseSchema.safeParse(result);
      if (parsed.success) return parsed.data;
      return failedProviderResponse({
        providerKey: registration.provider.providerKey,
        capability,
        latencyMs: Date.now() - startedAt,
        error: normalizeProviderError({
          category: 'validation',
          code: 'invalid_provider_response',
          message:
            'Provider returned a response that does not match the normalized contract.',
        }),
      });
    })
    .catch((error) =>
      failedProviderResponse({
        providerKey: registration.provider.providerKey,
        capability,
        latencyMs: Date.now() - startedAt,
        error: normalizeProviderError({
          category: 'unknown',
          code: 'provider_exception',
          message:
            error instanceof Error ? error.message : 'Provider execution failed.',
        }),
      }),
    );
  return Promise.race([execution, timeout]).then((result) => ({
    ...result,
    latencyMs: result.latencyMs || Date.now() - startedAt,
    error: result.error && {
      ...result.error,
      retryable:
        result.error.retryable && isRetryableProviderCategory(result.error.category),
    },
  }));
}

function requestHash(input: IntelligenceRequest): string {
  return JSON.stringify(input);
}

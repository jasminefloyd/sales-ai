import type { SupabaseClient } from '@supabase/supabase-js';

import type { CapabilityResult } from './capabilities';

export type ProviderRunStart = {
  productId: string;
  providerId: string;
  capability: string;
  jobId?: string;
  requestReference?: string;
  estimatedCost: number;
  actor: string;
  promptVersion?: string;
  modelIdentifier?: string;
};

export interface ProviderRunRecorder {
  start(input: ProviderRunStart): Promise<string>;
  succeed<T>(runId: string, result: CapabilityResult<T>): Promise<void>;
  fail<T>(runId: string, result: CapabilityResult<T>): Promise<void>;
}

export class SupabaseProviderRunRecorder implements ProviderRunRecorder {
  constructor(private readonly client: SupabaseClient) {}

  async start(input: ProviderRunStart): Promise<string> {
    const { data, error } = await this.client
      .from('sales_os_provider_runs')
      .insert({
        tenant_id: 'sales_os',
        product_id: input.productId,
        provider_id: input.providerId,
        capability: input.capability,
        job_id: input.jobId,
        request_reference: input.requestReference,
        status: 'started',
        estimated_cost: input.estimatedCost,
        prompt_version: input.promptVersion ?? null,
        model_identifier: input.modelIdentifier ?? null,
        created_by: input.actor,
        updated_by: input.actor,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async succeed<T>(runId: string, result: CapabilityResult<T>): Promise<void> {
    await this.finish(runId, 'succeeded', result);
  }

  async fail<T>(runId: string, result: CapabilityResult<T>): Promise<void> {
    await this.finish(runId, 'failed', result);
  }

  private async finish<T>(
    runId: string,
    status: 'succeeded' | 'failed',
    result: CapabilityResult<T>,
  ): Promise<void> {
    const { error } = await this.client
      .from('sales_os_provider_runs')
      .update({
        status,
        completed_at: new Date().toISOString(),
        latency_ms: result.latencyMs,
        actual_cost: result.cost,
        error_code: result.error?.code,
        error_detail: result.error?.message,
      })
      .eq('tenant_id', 'sales_os')
      .eq('id', runId);
    if (error) throw error;
  }
}

export class InMemoryProviderRunRecorder implements ProviderRunRecorder {
  readonly runs: Array<ProviderRunStart & { id: string; status: string }> = [];

  async start(input: ProviderRunStart): Promise<string> {
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({ ...input, id, status: 'started' });
    return id;
  }

  async succeed<T>(runId: string, result: CapabilityResult<T>): Promise<void> {
    void result;
    this.setStatus(runId, 'succeeded');
  }

  async fail<T>(runId: string, result: CapabilityResult<T>): Promise<void> {
    void result;
    this.setStatus(runId, 'failed');
  }

  private setStatus(runId: string, status: string) {
    const run = this.runs.find((entry) => entry.id === runId);
    if (run) run.status = status;
  }
}

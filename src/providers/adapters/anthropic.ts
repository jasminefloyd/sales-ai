import {
  capabilityResult,
  type CapabilityInput,
  type CapabilityProvider,
} from '../capabilities';

type AnthropicAdapterOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
};

type AnthropicMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function createAnthropicAdapter(
  options: AnthropicAdapterOptions,
): CapabilityProvider {
  return {
    providerKey: 'anthropic',
    modelIdentifier: options.model,
    capabilities: ['reasoning'],
    async execute<T>(capability: string, input: CapabilityInput) {
      const startedAt = Date.now();
      if (capability !== 'reasoning') {
        return capabilityResult<T>({
          provider: 'anthropic',
          success: false,
          data: null,
          cost: 0,
          latencyMs: Date.now() - startedAt,
          error: {
            code: 'unsupported_capability',
            message: `Anthropic does not support ${capability}.`,
            retryable: false,
          },
        });
      }

      try {
        const response = await fetch(
          `${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': options.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: options.model,
              max_tokens: options.maxTokens ?? 4096,
              system: typeof input.system === 'string' ? input.system : undefined,
              messages: [{ role: 'user', content: buildPrompt(input) }],
            }),
          },
        );
        const payload = (await response.json()) as AnthropicMessageResponse & {
          error?: { message?: string; type?: string };
        };
        if (!response.ok) {
          return capabilityResult<T>({
            provider: 'anthropic',
            success: false,
            data: null,
            cost: 0,
            latencyMs: Date.now() - startedAt,
            error: {
              code: payload.error?.type ?? `http_${response.status}`,
              message: payload.error?.message ?? 'Anthropic request failed.',
              retryable:
                response.status === 408 ||
                response.status === 429 ||
                response.status >= 500,
            },
          });
        }

        const text = payload.content?.find((block) => block.type === 'text')?.text;
        if (!text) {
          return capabilityResult<T>({
            provider: 'anthropic',
            success: false,
            data: null,
            cost: 0,
            latencyMs: Date.now() - startedAt,
            error: {
              code: 'empty_response',
              message: 'Anthropic returned no text content.',
              retryable: true,
            },
          });
        }

        return capabilityResult<T>({
          provider: 'anthropic',
          success: true,
          data: parseStructuredText(text) as T,
          cost: calculateCost(payload.usage, options),
          latencyMs: Date.now() - startedAt,
          externalIds: {
            model: options.model,
            inputTokens: String(payload.usage?.input_tokens ?? 0),
            outputTokens: String(payload.usage?.output_tokens ?? 0),
          },
        });
      } catch (error) {
        return capabilityResult<T>({
          provider: 'anthropic',
          success: false,
          data: null,
          cost: 0,
          latencyMs: Date.now() - startedAt,
          error: {
            code: 'network_error',
            message:
              error instanceof Error ? error.message : 'Anthropic request failed.',
            retryable: true,
          },
        });
      }
    },
  };
}

function buildPrompt(input: CapabilityInput): string {
  if (typeof input.prompt === 'string') return input.prompt;
  return JSON.stringify(input);
}

function parseStructuredText(value: string): unknown {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
    if (!fenced) return trimmed;
    try {
      return JSON.parse(fenced);
    } catch {
      return trimmed;
    }
  }
}

function calculateCost(
  usage: AnthropicMessageResponse['usage'],
  options: AnthropicAdapterOptions,
): number {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  return (
    (inputTokens / 1_000_000) * options.inputCostPerMillionTokens +
    (outputTokens / 1_000_000) * options.outputCostPerMillionTokens
  );
}

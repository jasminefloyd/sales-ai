import {
  capabilityResult,
  type CapabilityInput,
  type CapabilityName,
  type CapabilityProvider,
} from '../capabilities';
import {directSearchQuery,normalizeCompanyResults,executeHunter} from '../../../supabase/functions/_shared/directProviders';

type HttpOptions = { apiKey: string; model?: string; baseUrl?: string };

export function createOpenAiAdapter(options: HttpOptions): CapabilityProvider {
  return jsonAdapter(
    'openai',
    ['reasoning'],
    async (capability, input) => {
      if (capability !== 'reasoning')
        throw new Error(`OpenAI does not support ${capability}.`);
      const response = await fetch(
        `${options.baseUrl ?? 'https://api.openai.com/v1'}/responses`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            input: JSON.stringify(input),
            ...(input.outputSchema
              ? {
                  text: {
                    format: {
                      type: 'json_schema',
                      name: 'sales_os_output',
                      strict: true,
                      schema: input.outputSchema,
                    },
                  },
                }
              : {}),
          }),
        },
      );
      const payload = (await response.json()) as {
        output_text?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string };
      };
      if (!response.ok)
        throw providerHttpError(
          response.status,
          payload.error?.message ?? 'OpenAI request failed.',
        );
      return {
        data: parseJson(payload.output_text ?? ''),
        externalIds: {
          model: options.model ?? '',
          inputTokens: String(payload.usage?.input_tokens ?? 0),
          outputTokens: String(payload.usage?.output_tokens ?? 0),
        },
      };
    },
    options.model,
  );
}

export function createExaAdapter(options: HttpOptions): CapabilityProvider {
  return jsonAdapter(
    'exa',
    ['searchWeb', 'findCompany'],
    async (capability, input) => {
      if (capability !== 'searchWeb' && capability !== 'findCompany')
        throw new Error(`Exa does not support ${capability}.`);
      const response = await fetch(
        `${options.baseUrl ?? 'https://api.exa.ai'}/search`,
        {
          method: 'POST',
          headers: { 'x-api-key': options.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            query: capability === 'findCompany' ? directSearchQuery(input) : String(input.query ?? ''),
            numResults: Number(input.numResults ?? 10),
            contents: { highlights: true },
          }),
        },
      );
      const payload = (await response.json()) as {
        results?: unknown[];
        error?: string;
      };
      if (!response.ok)
        throw providerHttpError(
          response.status,
          payload.error ?? 'Exa request failed.',
        );
      return { data: capability === 'findCompany' ? normalizeCompanyResults(payload) : payload.results ?? [] };
    },
  );
}

export function createFirecrawlAdapter(options: HttpOptions): CapabilityProvider {
  return jsonAdapter('firecrawl', ['scrapePage'], async (capability, input) => {
    if (capability !== 'scrapePage')
      throw new Error(`Firecrawl does not support ${capability}.`);
    const response = await fetch(
      `${options.baseUrl ?? 'https://api.firecrawl.dev/v2'}/scrape`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url: String(input.url), formats: ['markdown'] }),
      },
    );
    const payload = (await response.json()) as { data?: unknown; error?: string };
    if (!response.ok)
      throw providerHttpError(
        response.status,
        payload.error ?? 'Firecrawl request failed.',
      );
    return { data: payload.data ?? payload };
  });
}

export function createHunterAdapter(options: HttpOptions): CapabilityProvider {
  return jsonAdapter(
    'hunter',
    ['findPerson', 'findContact', 'verifyContact'],
    async (capability, input) => {
      return { data: await executeHunter(capability,input,options.apiKey,fetch,options.baseUrl) };
    },
  );
}

function jsonAdapter(
  provider: string,
  capabilities: readonly CapabilityName[],
  execute: (
    capability: CapabilityName,
    input: CapabilityInput,
  ) => Promise<{ data: unknown; externalIds?: Record<string, string> }>,
  modelIdentifier?: string,
): CapabilityProvider {
  return {
    providerKey: provider,
    modelIdentifier,
    capabilities,
    async execute<T>(capability: CapabilityName, input: CapabilityInput) {
      const startedAt = Date.now();
      try {
        const result = await execute(capability, input);
        return capabilityResult<T>({
          provider,
          success: true,
          data: result.data as T,
          externalIds: result.externalIds,
          cost: 0,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        const status = error instanceof HttpProviderError ? error.status : undefined;
        return capabilityResult<T>({
          provider,
          success: false,
          data: null,
          cost: 0,
          latencyMs: Date.now() - startedAt,
          error: {
            code:
              error instanceof HttpProviderError ? error.code : 'provider_exception',
            message:
              error instanceof Error ? error.message : 'Provider request failed.',
            retryable:
              status === 408 ||
              status === 429 ||
              (status !== undefined && status >= 500),
          },
        });
      }
    },
  };
}

class HttpProviderError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function providerHttpError(status: number, message: string): HttpProviderError {
  return new HttpProviderError(status, `http_${status}`, message);
}
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

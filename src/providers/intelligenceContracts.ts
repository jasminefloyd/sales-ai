import { z } from 'zod';

export const IntelligenceCapabilitySchema = z.enum([
  'find_company',
  'find_contact',
  'enrich_company',
  'enrich_contact',
  'verify_email',
  'resolve_identity',
  'find_intent_signal',
  'export_audience',
]);

export type IntelligenceCapability = z.infer<typeof IntelligenceCapabilitySchema>;

const Uuid = z.string().uuid();
const JsonObject = z.record(z.string(), z.unknown());

const BaseRequest = z.object({
  productId: Uuid,
  audienceDefinitionId: Uuid.optional(),
  memberId: Uuid.optional(),
  input: JsonObject,
});

export const IntelligenceRequestSchemas: Record<
  IntelligenceCapability,
  typeof BaseRequest
> = {
  find_company: BaseRequest,
  find_contact: BaseRequest,
  enrich_company: BaseRequest,
  enrich_contact: BaseRequest,
  verify_email: BaseRequest,
  resolve_identity: BaseRequest,
  find_intent_signal: BaseRequest,
  export_audience: BaseRequest,
};

export const ProviderErrorCategorySchema = z.enum([
  'authentication',
  'authorization',
  'rate_limit',
  'timeout',
  'invalid_request',
  'not_found',
  'provider_unavailable',
  'policy',
  'validation',
  'unknown',
]);

export type ProviderErrorCategory = z.infer<typeof ProviderErrorCategorySchema>;

export const NormalizedProviderErrorSchema = z.object({
  category: ProviderErrorCategorySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  policyFailure: z.boolean(),
  providerStatus: z.number().int().optional(),
});

export type NormalizedProviderError = z.infer<typeof NormalizedProviderErrorSchema>;

export const ProviderEvidenceSchema = z.object({
  sourceSystem: z.string().min(1),
  sourceRecordId: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  observedAt: z.string().datetime({ offset: true }),
});

export const NormalizedProviderResponseSchema = z.object({
  success: z.boolean(),
  providerKey: z.string().min(1),
  capability: IntelligenceCapabilitySchema,
  records: z.array(JsonObject),
  evidence: z.array(ProviderEvidenceSchema),
  externalIds: z.record(z.string(), z.string()),
  confidence: z.number().min(0).max(1),
  observedAt: z.string().datetime({ offset: true }),
  freshnessAt: z.string().datetime({ offset: true }),
  cost: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  error: NormalizedProviderErrorSchema.nullable().optional(),
});

export type NormalizedProviderResponse = z.infer<
  typeof NormalizedProviderResponseSchema
>;

export type IntelligenceRequest = z.infer<typeof BaseRequest>;

export type IntelligenceProvider = {
  providerKey: string;
  modelIdentifier?: string;
  capabilities: readonly IntelligenceCapability[];
  execute(
    capability: IntelligenceCapability,
    request: IntelligenceRequest,
  ): Promise<NormalizedProviderResponse>;
};

export type ProviderHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'unavailable';

export type IntelligenceProviderRegistration = {
  providerId: string;
  provider: IntelligenceProvider;
  capability: IntelligenceCapability;
  enabled: boolean;
  qualified: boolean;
  healthStatus: ProviderHealthStatus;
  priority: number;
  timeoutMs: number;
};

const retryableCategories = new Set<ProviderErrorCategory>([
  'rate_limit',
  'timeout',
  'provider_unavailable',
  'unknown',
]);

export function isRetryableProviderCategory(category: ProviderErrorCategory): boolean {
  return retryableCategories.has(category);
}

export function normalizeProviderError(input: {
  category?: ProviderErrorCategory;
  code?: string;
  message: string;
  providerStatus?: number;
}): NormalizedProviderError {
  const category = input.category ?? categoryFromStatus(input.providerStatus);
  return {
    category,
    code: input.code ?? category,
    message: input.message,
    retryable: isRetryableProviderCategory(category),
    policyFailure: category === 'policy',
    ...(input.providerStatus === undefined
      ? {}
      : { providerStatus: input.providerStatus }),
  };
}

function categoryFromStatus(status?: number): ProviderErrorCategory {
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (status !== undefined && status >= 500) return 'provider_unavailable';
  if (status !== undefined && status >= 400) return 'invalid_request';
  return 'unknown';
}

export function failedProviderResponse(input: {
  providerKey: string;
  capability: IntelligenceCapability;
  error: NormalizedProviderError;
  latencyMs?: number;
}): NormalizedProviderResponse {
  const now = new Date().toISOString();
  return {
    success: false,
    providerKey: input.providerKey,
    capability: input.capability,
    records: [],
    evidence: [],
    externalIds: {},
    confidence: 0,
    observedAt: now,
    freshnessAt: now,
    cost: 0,
    latencyMs: input.latencyMs ?? 0,
    error: input.error,
  };
}

import {
  capabilityResult,
  type CapabilityInput,
  type CapabilityName,
  type CapabilityProvider,
} from '../capabilities';

type RedditOptions = {
  clientId: string;
  clientSecret: string;
  userAgent: string;
  tokenUrl?: string;
  apiUrl?: string;
};

type RedditToken = { access_token?: string; expires_in?: number };

export function createRedditAdapter(options: RedditOptions): CapabilityProvider {
  let token: { value: string; expiresAt: number } | undefined;
  return {
    providerKey: 'reddit',
    capabilities: ['searchCommunity', 'publishResponse'],
    async execute<T>(capability: CapabilityName, input: CapabilityInput) {
      const startedAt = Date.now();
      if (capability !== 'searchCommunity' && capability !== 'publishResponse')
        return failure<T>(
          'unsupported_capability',
          `Reddit does not support ${capability}.`,
          startedAt,
        );
      try {
        const accessToken = await getAccessToken(options, token);
        token = accessToken.cache;
        if (capability === 'publishResponse') {
          const response = await fetch(
            `${options.apiUrl ?? 'https://oauth.reddit.com'}/api/comment`,
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${accessToken.value}`,
                'content-type': 'application/x-www-form-urlencoded',
                'user-agent': options.userAgent,
              },
              body: new URLSearchParams({
                api_type: 'json',
                thing_id: String(input.parentId ?? ''),
                text: String(input.text ?? ''),
              }).toString(),
            },
          );
          const payload = (await response.json()) as {
            json?: {
              errors?: unknown[];
              data?: { things?: Array<{ data?: { id?: string; name?: string } }> };
            };
            message?: string;
          };
          if (!response.ok || (payload.json?.errors?.length ?? 0) > 0)
            return failure<T>(
              'publish_failed',
              payload.message ??
                JSON.stringify(payload.json?.errors ?? 'Reddit publish failed.'),
              startedAt,
              response.status >= 500 || response.status === 429,
            );
          const thing = payload.json?.data?.things?.[0]?.data;
          return capabilityResult<T>({
            provider: 'reddit',
            success: true,
            data: payload as T,
            externalIds: { externalMessageId: thing?.id ?? thing?.name ?? '' },
            cost: 0,
            latencyMs: Date.now() - startedAt,
          });
        }
        const params = new URLSearchParams({
          q: String(input.query ?? ''),
          limit: String(input.limit ?? input.numResults ?? 10),
          sort: String(input.sort ?? 'relevance'),
          t: String(input.time ?? 'all'),
          restrict_sr: 'false',
        });
        const response = await fetch(
          `${options.apiUrl ?? 'https://oauth.reddit.com'}/search.json?${params}`,
          {
            headers: {
              authorization: `Bearer ${accessToken.value}`,
              'user-agent': options.userAgent,
            },
          },
        );
        const payload = (await response.json()) as { data?: unknown; message?: string };
        if (!response.ok)
          return failure<T>(
            `http_${response.status}`,
            payload.message ?? 'Reddit request failed.',
            startedAt,
            response.status >= 500 || response.status === 429,
          );
        return capabilityResult<T>({
          provider: 'reddit',
          success: true,
          data: payload.data as T,
          cost: 0,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        return failure<T>(
          'provider_exception',
          error instanceof Error ? error.message : 'Reddit request failed.',
          startedAt,
          true,
        );
      }
    },
  };
}

async function getAccessToken(
  options: RedditOptions,
  cached?: { value: string; expiresAt: number },
) {
  if (cached && cached.expiresAt > Date.now() + 30_000)
    return { value: cached.value, cache: cached };
  const authorization = Buffer.from(
    `${options.clientId}:${options.clientSecret}`,
  ).toString('base64');
  const response = await fetch(
    options.tokenUrl ?? 'https://www.reddit.com/api/v1/access_token',
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${authorization}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': options.userAgent,
      },
      body: 'grant_type=client_credentials',
    },
  );
  const payload = (await response.json()) as RedditToken & { error?: string };
  if (!response.ok || !payload.access_token)
    throw new Error(payload.error ?? 'Reddit access token request failed.');
  const next = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  };
  return { value: next.value, cache: next };
}

function failure<T>(
  code: string,
  message: string,
  startedAt: number,
  retryable = false,
) {
  return capabilityResult<T>({
    provider: 'reddit',
    success: false,
    data: null,
    cost: 0,
    latencyMs: Date.now() - startedAt,
    error: { code, message, retryable },
  });
}

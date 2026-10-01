import {
  capabilityResult,
  type CapabilityInput,
  type CapabilityProvider,
} from '../capabilities';

export function createGmailAdapter(options: {
  accessToken: string;
  userId?: string;
}): CapabilityProvider {
  return {
    providerKey: 'gmail',
    capabilities: ['sendEmail'],
    async execute<T>(capability: string, input: CapabilityInput) {
      const startedAt = Date.now();
      if (capability !== 'sendEmail')
        return capabilityResult<T>({
          provider: 'gmail',
          success: false,
          data: null,
          cost: 0,
          error: {
            code: 'unsupported_capability',
            message: `Gmail does not support ${capability}.`,
            retryable: false,
          },
        });
      try {
        const raw = [
          `To: ${String(input.to)}`,
          `Subject: ${String(input.subject)}`,
          'Content-Type: text/plain; charset="UTF-8"',
          '',
          String(input.content),
        ].join('\r\n');
        const encoded = btoa(unescape(encodeURIComponent(raw)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const response = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(options.userId ?? 'me')}/messages/send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${options.accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ raw: encoded }),
          },
        );
        const payload = (await response.json()) as {
          id?: string;
          threadId?: string;
          error?: { message?: string };
        };
        if (!response.ok)
          return capabilityResult<T>({
            provider: 'gmail',
            success: false,
            data: null,
            cost: 0,
            latencyMs: Date.now() - startedAt,
            error: {
              code: `http_${response.status}`,
              message: payload.error?.message ?? 'Gmail send failed.',
              retryable: response.status === 429 || response.status >= 500,
            },
          });
        return capabilityResult<T>({
          provider: 'gmail',
          success: true,
          data: payload as T,
          cost: 0,
          latencyMs: Date.now() - startedAt,
          externalIds: {
            messageId: payload.id ?? '',
            threadId: payload.threadId ?? '',
          },
        });
      } catch (error) {
        return capabilityResult<T>({
          provider: 'gmail',
          success: false,
          data: null,
          cost: 0,
          latencyMs: Date.now() - startedAt,
          error: {
            code: 'network_error',
            message: error instanceof Error ? error.message : 'Gmail request failed.',
            retryable: true,
          },
        });
      }
    },
  };
}

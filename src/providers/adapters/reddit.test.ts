import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRedditAdapter } from './reddit';

describe('Reddit adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('obtains and caches a client-credentials token for community search', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            url.includes('access_token')
              ? JSON.stringify({ access_token: 'token-1', expires_in: 3600 })
              : JSON.stringify({ data: { children: [] } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = createRedditAdapter({
      clientId: 'client',
      clientSecret: 'secret',
      userAgent: 'sales-os-test/1.0',
    });

    const first = await adapter.execute('searchCommunity', {
      query: 'purchase intent',
    });
    const second = await adapter.execute('searchCommunity', { query: 'buying signal' });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
    });
  });
});

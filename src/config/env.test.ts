import { describe, expect, it } from 'vitest';

import { parseBrowserEnv } from './env-schema';

describe('Sales OS configuration', () => {
  it('accepts the required browser-safe Supabase configuration', () => {
    expect(
      parseBrowserEnv({
        SALES_OS_SUPABASE_URL: 'https://sales-os.supabase.co',
        SALES_OS_SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).toEqual({
      SALES_OS_SUPABASE_URL: 'https://sales-os.supabase.co',
      SALES_OS_SUPABASE_ANON_KEY: 'anon-key',
    });
  });

  it('rejects missing or malformed browser-safe configuration', () => {
    expect(() => parseBrowserEnv({})).toThrow();
  });
});

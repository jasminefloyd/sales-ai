import { parseBrowserEnv } from './env-schema';

export const browserEnv = parseBrowserEnv({
  SALES_OS_SUPABASE_URL: import.meta.env.SALES_OS_SUPABASE_URL,
  SALES_OS_SUPABASE_ANON_KEY: import.meta.env.SALES_OS_SUPABASE_ANON_KEY,
});

export const SALES_OS_TENANT_ID = 'sales_os' as const;

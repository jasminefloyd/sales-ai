/**
 * Server-only Supabase client factory.
 *
 * This module intentionally reads from process.env and is not imported by the
 * browser application. The service-role key bypasses RLS and must only be used
 * by trusted server/Edge Function code.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ServerSupabaseEnv = {
  SALES_OS_SUPABASE_URL: string;
  SALES_OS_SUPABASE_SERVICE_ROLE_KEY: string;
};

export function createServerSupabaseClient(
  env: ServerSupabaseEnv = {
    SALES_OS_SUPABASE_URL: process.env.SALES_OS_SUPABASE_URL ?? '',
    SALES_OS_SUPABASE_SERVICE_ROLE_KEY:
      process.env.SALES_OS_SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
): SupabaseClient {
  if (!env.SALES_OS_SUPABASE_URL || !env.SALES_OS_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Server Supabase configuration requires SALES_OS_SUPABASE_URL and SALES_OS_SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return createClient(
    env.SALES_OS_SUPABASE_URL,
    env.SALES_OS_SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

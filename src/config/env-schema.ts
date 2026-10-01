import { z } from 'zod';

export const browserEnvSchema = z.object({
  SALES_OS_SUPABASE_URL: z.string().url(),
  SALES_OS_SUPABASE_ANON_KEY: z.string().min(1),
});

export function parseBrowserEnv(input: unknown) {
  return browserEnvSchema.parse(input);
}

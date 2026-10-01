import { createClient } from '@supabase/supabase-js';

import { browserEnv } from '../../config/env';

export const supabaseBrowserClient = createClient(
  browserEnv.SALES_OS_SUPABASE_URL,
  browserEnv.SALES_OS_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
);

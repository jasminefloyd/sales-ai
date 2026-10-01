/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly SALES_OS_SUPABASE_URL: string;
  readonly SALES_OS_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

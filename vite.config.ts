import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'SALES_OS_SUPABASE_URL', 'SALES_OS_SUPABASE_ANON_KEY'],
  server: {
    port: 5173,
  },
});

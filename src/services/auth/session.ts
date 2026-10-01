import type { Session, User } from '@supabase/supabase-js';

import { supabaseBrowserClient } from '../../lib/supabase/browser';

export type AuthState = {
  session: Session | null;
  user: User | null;
};

export async function getAuthState(): Promise<AuthState> {
  const {
    data: { session },
  } = await supabaseBrowserClient.auth.getSession();

  return { session, user: session?.user ?? null };
}

export async function signInWithPassword(email: string, password: string) {
  return supabaseBrowserClient.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabaseBrowserClient.auth.signOut();
}

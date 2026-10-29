import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
export const supabaseConfigured = Boolean(url && anonKey);

// What an auth email link opened this page for ('signup', 'recovery', ...). Read before the client consumes the
// tokens in the URL and clears them, so a reset link still lands on the "choose a new password" screen.
export const authLinkType: string | null =
  new URLSearchParams(window.location.hash.slice(1)).get('type') ?? new URLSearchParams(window.location.search).get('type');

// Confirmation and password reset links carry the session in the URL: detectSessionInUrl turns it into a session.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

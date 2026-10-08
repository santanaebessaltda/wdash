import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * Client browser (anon key). Sem env valido  ->  null (app usa mock de demo).
 * Nunca use service_role aqui.
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon || url.includes("YOUR_PROJECT") || anon.includes("YOUR_ANON")) {
    client = null;
    return null;
  }
  client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Login = senha; recovery = OTP. Detectar sessao na URL no boot do PWA
      // ja apagou JWT em alguns browsers (race getSessionFromUrl).
      detectSessionInUrl: false,
      flowType: "pkce",
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
    },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}

/** Tipos das variaveis Vite usadas no app. */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

declare module "*.wav" {
  const src: string;
  export default src;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

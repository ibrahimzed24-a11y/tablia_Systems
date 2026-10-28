/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PROVISION_FUNCTION_URL?: string;
  readonly VITE_ANALYTICS_FUNCTION_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_LOGROCKET_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_FEATURE_PAYMENTS?: string;
  readonly VITE_FEATURE_INTEGRATIONS?: string;
  readonly VITE_FEATURE_AUDIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

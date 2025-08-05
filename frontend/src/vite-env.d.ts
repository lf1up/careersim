/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_SOCKET_URL: string
  readonly VITE_PORT: string
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
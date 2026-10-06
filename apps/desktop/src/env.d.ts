/** Compile-time flag from vite.config.ts: true in dev and tests, false in production builds. */
declare const __GALLERY__: boolean;

interface ImportMetaEnv {
  readonly VITE_ENABLE_GALLERY?: string;
}

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Contract with the Tauri shell in src-tauri (see docs/port/ui-foundation.md):
// `npm run dev` serves http://localhost:1420 with a strict port, `npm run build` writes ./dist.
const host = process.env.TAURI_DEV_HOST;
const platform = process.env.TAURI_ENV_PLATFORM;
const debug = Boolean(process.env.TAURI_ENV_DEBUG);

export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  // Keep Tauri CLI output readable.
  clearScreen: false,
  define: {
    // The component gallery (?surface=gallery) exists in dev and tests only. Production builds
    // replace this with `false`, so the gallery chunk is never emitted. Opt in for a review
    // build with VITE_ENABLE_GALLERY=true.
    __GALLERY__: JSON.stringify(command === 'serve' || mode === 'test' || process.env.VITE_ENABLE_GALLERY === 'true'),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // WebView2 on Windows is evergreen Chromium; macOS 14+ ships WKWebView from Safari 17.
    target: platform === 'windows' ? 'chrome120' : 'safari17',
    minify: !debug,
    sourcemap: debug,
  },
}));

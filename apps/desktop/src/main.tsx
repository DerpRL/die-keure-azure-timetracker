import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './theme/tokens.css';
import './theme/global.css';
import { AppProviders } from './app/AppProviders';
import { InterfaceSync } from './features/app/InterfaceSync';
import { isTauri } from './ipc';
import { EngineProvider } from './state/EngineProvider';
import { currentSurface } from './surface';
import { SurfaceRoot } from './surfaces/SurfaceRoot';
import { setPlatformOverride } from './shortcuts/platform';
import { applyAppearance, loadCachedPreferences, readSystemAppearance, saveCachedPreferences } from './theme/appearance';
import { parseInterfacePreferences, resolveAppearance, type InterfacePreferences } from './theme/preferences';

/**
 * Dev-only: the gallery previews surfaces in iframes and passes its current appearance in the
 * query (`theme`, `contrast`, `scale`, `motion=reduced`, `platform`). Ignored in production.
 */
function previewOverrides(search: string): { preferences?: InterfacePreferences; reducedMotion?: boolean } {
  if (!__GALLERY__) return {};
  const query = new URLSearchParams(search);
  const platform = query.get('platform');
  if (platform === 'macos' || platform === 'windows') setPlatformOverride(platform);
  if (!query.has('theme') && !query.has('contrast') && !query.has('scale') && !query.has('motion')) return {};
  return {
    preferences: parseInterfacePreferences({
      theme: query.get('theme'),
      contrast: query.get('contrast'),
      scale: Number(query.get('scale')),
    }),
    reducedMotion: query.get('motion') === 'reduced' ? true : undefined,
  };
}

const surface = currentSurface();
const overrides = previewOverrides(location.search);
const preferences = overrides.preferences ?? loadCachedPreferences();

// Paint the first frame in the right theme, scale and contrast before React mounts.
applyAppearance(resolveAppearance(preferences, readSystemAppearance(), overrides.reducedMotion));
document.documentElement.dataset.surface = surface;

/**
 * Outside Tauri (browser preview, gallery) a mock engine serves the sample slices, loaded as a
 * separate chunk that the desktop app never requests.
 */
async function installPreviewEngine(): Promise<void> {
  if (isTauri()) return;
  const [{ installMockEngine }, { sampleSlices, SAMPLE_NOW }, { pinClockTo }, { dayReviewToday }] = await Promise.all([
    import('./ipc/mockEngine'),
    import('./ipc/fixtures'),
    import('./ipc/sampleClock'),
    import('./ipc/fixtures/slices/dayReview'),
  ]);
  if (new URLSearchParams(location.search).get('clock') !== 'real') pinClockTo(SAMPLE_NOW);
  installMockEngine({ slices: sampleSlices(), latencyMs: 120 })
    // Settings → App → "Show onboarding again", and finishing it, like the engine.
    .handle('app.restartOnboarding', (_intent, mock) => mock.patchSlice('app', { onboarding: true }))
    .handle('app.finishOnboarding', (_intent, mock) => mock.patchSlice('app', { onboarding: false, visiblePage: 'settings' }))
    // The ticket picker opens and closes like the engine's flow.
    .handle('tracking.openPicker', (_intent, mock) => mock.patchSlice('flow', { surface: 'picker', draft: null }))
    .handle('tracking.closePicker', (_intent, mock) => mock.patchSlice('flow', { surface: 'none', draft: null }))
    // Today's day check and reviewing an earlier day: the sample review is Monday's.
    .handle('dayReview.setDay', (intent, mock) =>
      mock.setSlice('dayReview', intent.day === '2026-10-06' ? dayReviewToday : { ...sampleSlices().dayReview!, selectedDay: intent.day }),
    );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  void installPreviewEngine().then(() => {
    root.render(
      <StrictMode>
        <AppProviders
          theme={{
            defaultPreferences: preferences,
            onPreferencesChange: overrides.preferences ? undefined : saveCachedPreferences,
            reducedMotion: overrides.reducedMotion,
          }}
          builtInShortcuts={surface !== 'mini'}
        >
          <EngineProvider connect={surface !== 'gallery'}>
            <InterfaceSync />
            <SurfaceRoot surface={surface} />
          </EngineProvider>
        </AppProviders>
      </StrictMode>,
    );
  });
}

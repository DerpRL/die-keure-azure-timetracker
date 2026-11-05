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
 * separate chunk that the desktop app never requests. `?setup=first-run` starts like a fresh
 * install: the onboarding, then Settings with nothing saved.
 */
async function installPreviewEngine(): Promise<void> {
  if (isTauri()) return;
  const [
    { installMockEngine, MockEngineError },
    { sampleSlices, SAMPLE_NOW },
    { pinClockTo },
    { dayReviewToday },
    { handlePickerPreview },
    { onboardingApp, unconfiguredConnection, unconfiguredSettings },
  ] = await Promise.all([
    import('./ipc/mockEngine'),
    import('./ipc/fixtures'),
    import('./ipc/sampleClock'),
    import('./ipc/fixtures/slices/dayReview'),
    import('./ipc/fixtures/pickerPreview'),
    import('./ipc/fixtures/slices/settings'),
  ]);
  const query = new URLSearchParams(location.search);
  if (query.get('clock') !== 'real') pinClockTo(SAMPLE_NOW);
  const firstRun = query.get('setup') === 'first-run';
  const slices = firstRun
    ? { ...sampleSlices(), app: onboardingApp, settings: unconfiguredSettings, connection: unconfiguredConnection }
    : sampleSlices();
  handlePickerPreview(installMockEngine({ slices, latencyMs: 120 }))
    // Settings → Save stores the configuration and the typed secrets, like the engine.
    .handle('settings.save', (intent, mock) => {
      const settings = mock.slices.settings;
      if (!settings) return;
      mock.setSlice('settings', {
        ...settings,
        configuration: intent.configuration,
        hasAzurePat: settings.hasAzurePat || intent.azurePat !== '',
        hasSevenPaceToken: settings.hasSevenPaceToken || intent.sevenPaceToken !== '',
        savedAt: new Date().toISOString(),
      });
    })
    // Test and save: every token works, except one containing "wrong" (to preview the error).
    .handle('settings.testAzurePat', (intent) => {
      if (intent.azurePat.includes('wrong')) {
        throw new MockEngineError(
          'authentication',
          `Azure DevOps did not accept this token for “${intent.organization}”. Check that you copied all of it, that it has not expired, and that it was created for this organization with the Work Items (Read) scope.`,
        );
      }
    })
    // Settings → App → "Show onboarding again", and finishing it, like the engine.
    .handle('app.restartOnboarding', (_intent, mock) => mock.patchSlice('app', { onboarding: true }))
    .handle('app.finishOnboarding', (_intent, mock) => mock.patchSlice('app', { onboarding: false, visiblePage: 'overview' }))
    // Deleting an offline draft (or the running local timer), like the engine's `offline.remove`.
    .handle('offline.remove', (intent, mock) => {
      const offline = mock.slices.offline;
      const draft = offline?.drafts.find((entry) => entry.id === intent.draftId);
      if (!offline || !draft) return;
      const drafts = offline.drafts.filter((entry) => entry.id !== intent.draftId);
      const running = offline.active?.id === intent.draftId;
      mock.patchSlice('offline', {
        drafts,
        active: running ? null : offline.active,
        readyCount: drafts.filter((entry) => !!entry.end && entry.status !== 'Synced to 7pace').length,
        review: null,
      });
      if (running) mock.patchSlice('tracking', { local: null });
    })
    // The ticket picker opens and closes like the engine's flow.
    .handle('tracking.openPicker', (_intent, mock) => mock.patchSlice('flow', { surface: 'picker', draft: null }))
    .handle('tracking.closePicker', (_intent, mock) => mock.patchSlice('flow', { surface: 'none', draft: null }))
    // Today's day check and reviewing an earlier day: the sample review is Monday's.
    .handle('dayReview.setDay', (intent, mock) =>
      mock.setSlice('dayReview', intent.day === '2026-10-06' ? dayReviewToday : { ...sampleSlices().dayReview!, selectedDay: intent.day }),
    )
    // Timesheet · Day shows the chosen day's sample worklogs and opens an entry in the edit
    // sheet (from Today's "Your day" or Week's "Selected entry"), like the engine.
    .handle('timeEditor.setDay', (intent, mock) =>
      mock.patchSlice('timeEditor', {
        day: intent.day,
        logs: (mock.slices.history?.logs ?? []).filter((log) => new Date(log.timestamp).toLocaleDateString('en-CA') === intent.day),
      }),
    )
    .handle('timeEditor.select', (intent, mock) => {
      const log = mock.slices.history?.logs.find((entry) => entry.id === intent.logId);
      if (!log) return;
      const end = new Date(Date.parse(log.timestamp) + log.length * 1000).toISOString();
      mock.patchSlice('timeEditor', { selected: log, mode: 'edit', start: log.timestamp, end, review: null, plan: null });
    })
    .handle('timeEditor.cancel', (_intent, mock) => mock.patchSlice('timeEditor', { selected: null, start: null, end: null, review: null, plan: null }));
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

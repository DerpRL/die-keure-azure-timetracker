import type { ReactElement } from 'react';
import type { SliceMap, SliceName, SliceUpdate } from '../ipc/contract';
import { sampleSlices } from '../ipc/fixtures';
import { installMockEngine, type MockEngine } from '../ipc/mockEngine';
import { EngineProvider } from '../state/EngineProvider';
import { SliceStore } from '../state/store';
import { renderWithProviders, type ProviderOptions } from './render';

export interface EngineRenderOptions extends ProviderOptions {
  /** Slices the store starts with. Defaults to every sample slice; pass `{}` for none. */
  slices?: Partial<SliceMap>;
  /** Extra slices merged over `slices` (the usual way to set up one test's state). */
  with?: Partial<SliceMap>;
}

function updatesOf(slices: Partial<SliceMap>): SliceUpdate[] {
  return (Object.keys(slices) as SliceName[]).map((name) => ({ name, value: slices[name] }) as SliceUpdate);
}

/**
 * Renders `ui` with the app providers and a mock engine whose slices are already in the store
 * (no waiting for a resync). Dispatched intents are recorded on `engine`; `engine.setSlice`
 * publishes a change to the rendered tree.
 *
 *   const { engine, user } = renderWithEngine(<OverviewPage />, { with: { tracking: stopped } });
 *   await user.click(screen.getByRole('button', { name: 'Stop' }));
 *   expect(engine.dispatched('tracking.stop')).toHaveLength(1);
 */
export function renderWithEngine(ui: ReactElement, { slices, with: extra, ...options }: EngineRenderOptions = {}) {
  const initial = { ...(slices ?? sampleSlices()), ...extra };
  const engine: MockEngine = installMockEngine({ slices: initial });
  const store = new SliceStore();
  store.apply(updatesOf(initial));
  // Keep the store in step with what the mock engine publishes.
  void engine.ipc.listen('engine://slices', (payload) => store.apply(payload as SliceUpdate[]));
  const result = renderWithProviders(
    <EngineProvider store={store} connect={false}>
      {ui}
    </EngineProvider>,
    options,
  );
  return { engine, store, ...result };
}

/**
 * Typed calls into the Rust engine (`apps/desktop/src-tauri/src/engine_bridge.rs`):
 * `engine_dispatch` runs one intent, `engine_resync` re-sends every slice through the
 * `engine://slices` event. Outside Tauri these go to the mock backend (see `mockEngine.ts`).
 */
import { invoke, listen, type Unlisten } from './index';
import { SLICES_EVENT, type Intent, type IntentResult, type SliceUpdate } from './contract';

/** Runs one intent. Resolves with its result (usually `null`); rejects with an `IpcError`. */
export function dispatch<I extends Intent>(intent: I): Promise<IntentResult<I['type']>> {
  return invoke<IntentResult<I['type']>>('engine_dispatch', { intent });
}

/**
 * Asks the engine to send every slice again as `engine://slices`. Call it after subscribing:
 * the full set then arrives in order with the regular updates, so nothing is missed and an
 * older value never overwrites a newer one.
 */
export function resync(): Promise<void> {
  return invoke<void>('engine_resync');
}

/** Subscribes to slice batches (only slices whose JSON changed). */
export function onSlices(handler: (updates: SliceUpdate[]) => void): Promise<Unlisten> {
  return listen<SliceUpdate[]>(SLICES_EVENT, handler);
}

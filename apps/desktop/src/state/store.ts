/**
 * The one UI store: the latest value of every engine slice, keyed by slice name. Components
 * subscribe per slice (`useSlice`), so a batch that changes `tracking` re-renders only what
 * reads `tracking`.
 */
import type { SliceMap, SliceName, SliceUpdate } from '../ipc/contract';
import { onSlices, resync } from '../ipc/engine';
import type { Unlisten } from '../ipc';

type Listener = () => void;

export class SliceStore {
  private readonly values = new Map<SliceName, unknown>();
  private readonly listeners = new Map<SliceName, Set<Listener>>();
  private readonly anyListeners = new Set<Listener>();

  get<K extends SliceName>(name: K): SliceMap[K] | undefined {
    return this.values.get(name) as SliceMap[K] | undefined;
  }

  /** True once the slice arrived at least once. */
  has(name: SliceName): boolean {
    return this.values.has(name);
  }

  /** Applies one batch, then notifies each changed slice's subscribers once. */
  apply(updates: readonly SliceUpdate[]): void {
    const changed = new Set<SliceName>();
    for (const update of updates) {
      this.values.set(update.name, update.value);
      changed.add(update.name);
    }
    for (const name of changed) {
      for (const listener of this.listeners.get(name) ?? []) listener();
    }
    if (changed.size > 0) for (const listener of this.anyListeners) listener();
  }

  /** Replaces one slice (tests and previews). */
  set<K extends SliceName>(name: K, value: SliceMap[K]): void {
    this.apply([{ name, value } as SliceUpdate]);
  }

  subscribe(name: SliceName, listener: Listener): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Called after every batch, whatever changed. */
  subscribeAll(listener: Listener): () => void {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  clear(): void {
    const names = [...this.values.keys()];
    this.values.clear();
    for (const name of names) {
      for (const listener of this.listeners.get(name) ?? []) listener();
    }
    for (const listener of this.anyListeners) listener();
  }
}

/** The store every surface of this window shares. */
export const store = new SliceStore();

/**
 * Subscribes `target` to the engine and requests every slice once. Returns the unsubscribe
 * function. Safe to call again after the engine restarts (the resync replaces every value).
 */
export async function connectStore(target: SliceStore = store): Promise<Unlisten> {
  const unlisten = await onSlices((updates) => target.apply(updates));
  try {
    await resync();
  } catch (error) {
    unlisten();
    throw error;
  }
  return unlisten;
}

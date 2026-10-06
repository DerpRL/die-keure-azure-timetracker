/**
 * Sample slices for the browser preview, the gallery and tests. Each file in `slices/` exports
 * `default` as part of a `SliceMap` (type-checked against the generated contract); this module
 * merges them. Page work adds or extends the file for its own slices.
 */
import type { SliceMap } from '../contract';

export { defaultConfiguration } from './defaults';

const modules = import.meta.glob<{ default: Partial<SliceMap> }>('./slices/*.ts', { eager: true });

/** A fresh copy of every sample slice. */
export function sampleSlices(): Partial<SliceMap> {
  const merged: Partial<SliceMap> = {};
  for (const path of Object.keys(modules).sort()) {
    Object.assign(merged, structuredClone(modules[path]?.default ?? {}));
  }
  return merged;
}

/** Fixed "now" of the samples: Tuesday 6 October 2026, 10:00 in Brussels. */
export const SAMPLE_NOW = '2026-10-06T08:00:00Z';

import {
  DEFAULT_INTERFACE_PREFERENCES,
  DEFAULT_SYSTEM_APPEARANCE,
  parseInterfacePreferences,
  type InterfacePreferences,
  type ResolvedAppearance,
  type SystemAppearance,
} from './preferences';

export const MEDIA_QUERIES = {
  dark: '(prefers-color-scheme: dark)',
  increasedContrast: '(prefers-contrast: more)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
  forcedColors: '(forced-colors: active)',
} as const satisfies Record<keyof SystemAppearance, string>;

const keys = Object.keys(MEDIA_QUERIES) as Array<keyof SystemAppearance>;

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

let cachedKey = '';
let cached: SystemAppearance = DEFAULT_SYSTEM_APPEARANCE;

/** Snapshot of the OS appearance; returns the same object while nothing changed. */
export function readSystemAppearance(): SystemAppearance {
  const next = Object.fromEntries(keys.map((key) => [key, matches(MEDIA_QUERIES[key])])) as unknown as SystemAppearance;
  const key = keys.map((k) => (next[k] ? '1' : '0')).join('');
  if (key !== cachedKey) {
    cachedKey = key;
    cached = next;
  }
  return cached;
}

export function subscribeSystemAppearance(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const lists = keys.map((key) => window.matchMedia(MEDIA_QUERIES[key]));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

/** Writes the resolved appearance to the element that owns the tokens (normally <html>). */
export function applyAppearance(resolved: ResolvedAppearance, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = resolved.theme;
  root.dataset.contrast = resolved.contrast;
  root.style.setProperty('--ui-scale', String(resolved.scale));
  if (resolved.reducedMotion) root.dataset.reducedMotion = 'true';
  else delete root.dataset.reducedMotion;
}

const STORAGE_KEY = 'att.interfacePreferences';

/**
 * Last-applied preferences, cached locally so the first paint already has the right theme. The
 * settings store in the Rust core stays authoritative once it is wired up.
 */
export function loadCachedPreferences(): InterfacePreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseInterfacePreferences(JSON.parse(raw)) : { ...DEFAULT_INTERFACE_PREFERENCES };
  } catch {
    return { ...DEFAULT_INTERFACE_PREFERENCES };
  }
}

export function saveCachedPreferences(preferences: InterfacePreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable (private mode, quota); the cache is only an optimisation.
  }
}

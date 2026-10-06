import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from './ipc';

/** The three windows of the app, plus the dev-only component gallery. */
export type Surface = 'main' | 'panel' | 'mini' | 'gallery';

const WINDOW_SURFACES = ['main', 'panel', 'mini'] as const;

/** Compile-time: false in production builds, which therefore never contain the gallery. */
export const GALLERY_ENABLED: boolean = __GALLERY__;

export interface SurfaceEnvironment {
  /** Tauri window label when running inside Tauri, otherwise null. */
  tauriLabel: string | null;
  /** `location.search` of the page. */
  search: string;
  allowGallery: boolean;
}

function asWindowSurface(value: string | null | undefined): Surface | null {
  return WINDOW_SURFACES.find((surface) => surface === value) ?? null;
}

/**
 * Inside Tauri the window label decides (`main`, `panel`, `mini`; unknown labels fall back to
 * `main`). In a plain browser `?surface=main|panel|mini|gallery` decides, defaulting to `main`;
 * `gallery` is honoured only when the gallery is compiled in.
 */
export function resolveSurface({ tauriLabel, search, allowGallery }: SurfaceEnvironment): Surface {
  if (tauriLabel !== null) return asWindowSurface(tauriLabel) ?? 'main';
  const requested = new URLSearchParams(search).get('surface');
  if (requested === 'gallery') return allowGallery ? 'gallery' : 'main';
  return asWindowSurface(requested) ?? 'main';
}

export function readTauriWindowLabel(): string | null {
  if (!isTauri()) return null;
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}

export function currentSurface(): Surface {
  return resolveSurface({
    tauriLabel: readTauriWindowLabel(),
    search: typeof location === 'undefined' ? '' : location.search,
    allowGallery: GALLERY_ENABLED,
  });
}

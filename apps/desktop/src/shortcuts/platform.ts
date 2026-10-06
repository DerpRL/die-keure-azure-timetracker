import { useSyncExternalStore } from 'react';

/** Host platform as far as the UI cares: modifier keys, labels and platform-only pages. */
export type Platform = 'macos' | 'windows' | 'linux' | 'other';

interface UserAgentDataLike {
  platform?: string;
}

export interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: UserAgentDataLike;
}

/** Reads `navigator.userAgentData.platform` first (WebView2), then `navigator.platform` (WKWebView). */
export function detectPlatform(nav: NavigatorLike | undefined = globalThis.navigator): Platform {
  const hints = [nav?.userAgentData?.platform, nav?.platform, nav?.userAgent]
    .filter((hint): hint is string => typeof hint === 'string' && hint.length > 0)
    .map((hint) => hint.toLowerCase());
  for (const hint of hints) {
    if (/mac|iphone|ipad|ipod/.test(hint)) return 'macos';
    if (/win/.test(hint)) return 'windows';
    if (/linux|x11|cros/.test(hint)) return 'linux';
  }
  return 'other';
}

let override: Platform | null = null;
let detected: Platform | null = null;
const listeners = new Set<() => void>();

export function getPlatform(): Platform {
  if (override) return override;
  detected ??= detectPlatform();
  return detected;
}

/** Forces a platform (tests, the gallery). Pass null to return to detection. */
export function setPlatformOverride(platform: Platform | null): void {
  if (override === platform) return;
  override = platform;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlatform(): Platform {
  return useSyncExternalStore(subscribe, getPlatform, getPlatform);
}

/** ⌘ on macOS, Ctrl elsewhere. */
export function usesMetaAsPrimary(platform: Platform): boolean {
  return platform === 'macos';
}

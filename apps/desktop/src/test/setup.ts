import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetMatchMedia, installMatchMedia } from './matchMedia';
// Keep this file free of app modules that tests mock (e.g. src/ipc imports @tauri-apps/api):
// setup runs before a test file registers its vi.mock calls.
import { setPlatformOverride } from '../shortcuts/platform';
import { clearAnnouncements } from '../components/Announcer';

installMatchMedia();

class ResizeObserverStub implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    // jsdom has no layout; report a stable desktop-like box once so charts render.
    const rect = { width: 640, height: 240, top: 0, left: 0, bottom: 240, right: 640, x: 0, y: 0 };
    const entry = {
      target,
      contentRect: { ...rect, toJSON: () => rect },
      borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
      contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
      devicePixelContentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

beforeEach(() => {
  setPlatformOverride('macos');
});

afterEach(() => {
  cleanup();
  clearAnnouncements();
  resetMatchMedia();
  setPlatformOverride(null);
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.removeAttribute('data-reduced-motion');
  document.documentElement.style.removeProperty('--ui-scale');
});

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './app/AppProviders';
import { currentSurface, resolveSurface } from './surface';
import { SurfaceRoot } from './surfaces/SurfaceRoot';

const tauriWindow = vi.hoisted(() => ({ label: 'main' }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: tauriWindow.label }),
}));

function withTauri(label: string) {
  tauriWindow.label = label;
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  window.history.replaceState(null, '', '/');
});

describe('resolveSurface', () => {
  it('uses the Tauri window label inside Tauri', () => {
    expect(resolveSurface({ tauriLabel: 'panel', search: '?surface=mini', allowGallery: true })).toBe('panel');
    expect(resolveSurface({ tauriLabel: 'mini', search: '', allowGallery: true })).toBe('mini');
    expect(resolveSurface({ tauriLabel: 'main', search: '', allowGallery: true })).toBe('main');
    // Unknown windows and the gallery label never open the gallery inside Tauri.
    expect(resolveSurface({ tauriLabel: 'gallery', search: '?surface=gallery', allowGallery: true })).toBe('main');
    expect(resolveSurface({ tauriLabel: 'settings', search: '', allowGallery: true })).toBe('main');
  });

  it('uses ?surface= in a plain browser, defaulting to main', () => {
    expect(resolveSurface({ tauriLabel: null, search: '', allowGallery: true })).toBe('main');
    expect(resolveSurface({ tauriLabel: null, search: '?surface=panel', allowGallery: true })).toBe('panel');
    expect(resolveSurface({ tauriLabel: null, search: '?surface=mini&x=1', allowGallery: true })).toBe('mini');
    expect(resolveSurface({ tauriLabel: null, search: '?surface=unknown', allowGallery: true })).toBe('main');
    expect(resolveSurface({ tauriLabel: null, search: '?surface=gallery', allowGallery: true })).toBe('gallery');
  });

  it('never resolves the gallery when it is compiled out (production)', () => {
    expect(resolveSurface({ tauriLabel: null, search: '?surface=gallery', allowGallery: false })).toBe('main');
  });

  it('reads the label from getCurrentWindow() when __TAURI_INTERNALS__ exists', () => {
    window.history.replaceState(null, '', '/?surface=mini');
    expect(currentSurface()).toBe('mini');
    withTauri('panel');
    expect(currentSurface()).toBe('panel');
  });
});

describe('SurfaceRoot', () => {
  const renderSurface = (surface: Parameters<typeof SurfaceRoot>[0]['surface']) =>
    render(
      <AppProviders>
        <SurfaceRoot surface={surface} />
      </AppProviders>,
    );

  it('renders the main window shell for main', () => {
    const { container } = renderSurface('main');
    expect(container.querySelector('[data-surface="main"]')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  });

  it('renders the tray panel for panel', () => {
    const { container } = renderSurface('panel');
    expect(container.querySelector('[data-surface="panel"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Azure timetracker' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('renders the mini timer for mini', () => {
    const { container } = renderSurface('mini');
    expect(container.querySelector('[data-surface="mini"]')).not.toBeNull();
    expect(screen.getByRole('main', { name: 'Mini timer' })).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'Elapsed time' })).toBeInTheDocument();
  });

  it('loads the gallery lazily in development builds', async () => {
    renderSurface('gallery');
    expect(await screen.findByRole('heading', { level: 1, name: /component gallery/i })).toBeInTheDocument();
  });
});

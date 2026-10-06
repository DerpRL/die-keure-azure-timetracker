import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setMediaFeature } from '../test/matchMedia';
import {
  DEFAULT_INTERFACE_PREFERENCES,
  parseInterfacePreferences,
  resolveAppearance,
  type InterfacePreferences,
} from './preferences';
import { ThemeProvider, useReducedMotion, useTheme } from './ThemeProvider';

const system = { dark: false, increasedContrast: false, reducedMotion: false, forcedColors: false };

describe('interface preferences', () => {
  it('decodes the 1.14 JSON shape and falls back for unsupported values', () => {
    expect(parseInterfacePreferences({ theme: 'dark', scale: 125, contrast: 'increased' })).toEqual({
      theme: 'dark',
      scale: 125,
      contrast: 'increased',
    });
    expect(parseInterfacePreferences({ theme: 'sepia', scale: 175, contrast: 7 })).toEqual(DEFAULT_INTERFACE_PREFERENCES);
    expect(parseInterfacePreferences(null)).toEqual(DEFAULT_INTERFACE_PREFERENCES);
    expect(parseInterfacePreferences({ scale: 90 })).toEqual({ theme: 'system', scale: 90, contrast: 'system' });
  });

  it('resolves system values like Swift isDark / increasedContrast', () => {
    const prefs: InterfacePreferences = { theme: 'system', scale: 110, contrast: 'system' };
    expect(resolveAppearance(prefs, { ...system, dark: true, increasedContrast: true })).toMatchObject({
      theme: 'dark',
      contrast: 'increased',
      scale: 1.1,
    });
    expect(resolveAppearance({ ...prefs, theme: 'light', contrast: 'standard' }, { ...system, dark: true, increasedContrast: true })).toMatchObject({
      theme: 'light',
      contrast: 'standard',
    });
    expect(resolveAppearance({ ...prefs, theme: 'dark', contrast: 'increased' }, system)).toMatchObject({
      theme: 'dark',
      contrast: 'increased',
    });
  });
});

function Probe() {
  const { resolved, setPreferences, preferences } = useTheme();
  const reduced = useReducedMotion();
  return (
    <div>
      <span data-testid="resolved">{`${resolved.theme}/${resolved.contrast}/${resolved.scale}/${String(reduced)}`}</span>
      <button type="button" onClick={() => setPreferences({ ...preferences, scale: 150 })}>
        Larger
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  it('applies theme, contrast and scale to the root element so rem layouts reflow', () => {
    render(
      <ThemeProvider defaultPreferences={{ theme: 'dark', scale: 125, contrast: 'increased' }}>
        <Probe />
      </ThemeProvider>,
    );
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.contrast).toBe('increased');
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.25');
    act(() => screen.getByRole('button', { name: 'Larger' }).click());
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.5');
  });

  it('follows the operating system when set to System', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('light/standard/1/false');
    act(() => {
      setMediaFeature('prefers-color-scheme: dark', true);
      setMediaFeature('prefers-contrast: more', true);
      setMediaFeature('prefers-reduced-motion: reduce', true);
    });
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark/increased/1/true');
    expect(document.documentElement.dataset.reducedMotion).toBe('true');
  });

  it('can force reduced motion for previews', () => {
    render(
      <ThemeProvider reducedMotion>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent(/true$/);
  });
});

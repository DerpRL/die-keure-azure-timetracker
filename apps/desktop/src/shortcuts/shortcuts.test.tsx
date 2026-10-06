import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TextField } from '../components/Fields';
import { AppShell } from '../layout/AppShell';
import type { PageId } from '../layout/navigation';
import { expectNoA11yViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { useCommand, useSaveShortcut } from './hooks';
import { formatKeyCombo, isTextEntryTarget, matchesKeyCombo, type KeyCombo } from './keys';
import { detectPlatform, getPlatform, setPlatformOverride } from './platform';

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

describe('platform detection', () => {
  it('prefers userAgentData, then navigator.platform, then the user agent', () => {
    expect(detectPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe('windows');
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('macos');
    expect(detectPlatform({ platform: 'Win32' })).toBe('windows');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('linux');
    expect(detectPlatform({})).toBe('other');
  });

  it('can be overridden for tests and previews', () => {
    setPlatformOverride('windows');
    expect(getPlatform()).toBe('windows');
    setPlatformOverride('macos');
    expect(getPlatform()).toBe('macos');
  });
});

describe('key combos', () => {
  it('formats with platform modifiers', () => {
    const palette: KeyCombo = { key: 'k', mod: true };
    expect(formatKeyCombo(palette, 'macos')).toMatchObject({ text: '⌘K', spoken: 'Command K', aria: 'Meta+K' });
    expect(formatKeyCombo(palette, 'windows')).toMatchObject({ text: 'Ctrl+K', spoken: 'Control K', aria: 'Control+K' });
    expect(formatKeyCombo({ key: 'd', mod: true, shift: true }, 'macos').text).toBe('⇧⌘D');
    expect(formatKeyCombo({ key: 't', ctrl: true, alt: true }, 'macos').text).toBe('⌃⌥T');
    expect(formatKeyCombo({ key: '?' }, 'windows').spoken).toBe('Question mark');
  });

  it('matches the primary modifier per platform', () => {
    const save: KeyCombo = { key: 's', mod: true };
    expect(matchesKeyCombo(keydown({ key: 's', metaKey: true }), save, 'macos')).toBe(true);
    expect(matchesKeyCombo(keydown({ key: 's', ctrlKey: true }), save, 'macos')).toBe(false);
    expect(matchesKeyCombo(keydown({ key: 's', ctrlKey: true }), save, 'windows')).toBe(true);
    expect(matchesKeyCombo(keydown({ key: 's', metaKey: true }), save, 'windows')).toBe(false);
    // AltGr on Belgian AZERTY reports Ctrl+Alt and must not trigger Ctrl shortcuts.
    expect(matchesKeyCombo(keydown({ key: 's', ctrlKey: true, altKey: true }), save, 'windows')).toBe(false);
  });

  it('recognises digit keys by physical position (AZERTY) and Option-modified letters', () => {
    expect(matchesKeyCombo(keydown({ key: '&', code: 'Digit1', metaKey: true }), { key: '1', mod: true }, 'macos')).toBe(true);
    expect(matchesKeyCombo(keydown({ key: '†', code: 'KeyT', altKey: true, ctrlKey: true }), { key: 't', alt: true, ctrl: true }, 'macos')).toBe(true);
    // "?" needs Shift on QWERTY and AZERTY alike; Shift is not compared for symbols.
    expect(matchesKeyCombo(keydown({ key: '?', shiftKey: true }), { key: '?' }, 'macos')).toBe(true);
  });

  it('detects text entry targets', () => {
    const input = document.createElement('input');
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const spin = document.createElement('div');
    spin.setAttribute('role', 'spinbutton');
    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTextEntryTarget(checkbox)).toBe(false);
    expect(isTextEntryTarget(editable)).toBe(true);
    expect(isTextEntryTarget(spin)).toBe(true);
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false);
  });
});

function Shell({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [page, setPage] = useState<PageId>('overview');
  return (
    <AppShell
      currentPage={page}
      onNavigate={(next) => {
        setPage(next);
        onNavigate(next);
      }}
      header={<h1>Page</h1>}
    >
      <TextField label="Comment" />
    </AppShell>
  );
}

describe('page shortcuts', () => {
  it('follow the visible sidebar order on macOS (⌘1…⌘9, ⌘0)', async () => {
    const onNavigate = vi.fn();
    const { user } = renderWithProviders(<Shell onNavigate={onNavigate} />, { platform: 'macos' });
    await user.keyboard('{Meta>}4{/Meta}');
    expect(onNavigate).toHaveBeenLastCalledWith('offlineDrafts');
    await user.keyboard('{Meta>}5{/Meta}');
    expect(onNavigate).toHaveBeenLastCalledWith('statistics');
    await user.keyboard('{Meta>}0{/Meta}');
    expect(onNavigate).toHaveBeenLastCalledWith('figma');
    // Eleven pages: Settings has no digit (it keeps ⌘, from the app menu).
    expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-keyshortcuts', 'Meta+1');
  });

  it('skip hidden pages on Windows, where Agenda does not exist', async () => {
    const onNavigate = vi.fn();
    const { user } = renderWithProviders(<Shell onNavigate={onNavigate} />, { platform: 'windows' });
    expect(screen.queryByRole('button', { name: 'Agenda' })).toBeNull();
    await user.keyboard('{Control>}3{/Control}');
    expect(onNavigate).toHaveBeenLastCalledWith('offlineDrafts');
    await user.keyboard('{Control>}0{/Control}');
    expect(onNavigate).toHaveBeenLastCalledWith('settings');
  });
});

function Commands({ onHelp, onSave }: { onHelp: () => void; onSave: () => void }) {
  useCommand({ id: 'test.help', label: 'Help', shortcut: { key: 'h' }, onAction: onHelp });
  useSaveShortcut(onSave);
  return <TextField label="Comment" />;
}

describe('shortcut dispatch', () => {
  it('never fires while typing unless the command allows it', async () => {
    const onHelp = vi.fn();
    const onSave = vi.fn();
    const { user } = renderWithProviders(<Commands onHelp={onHelp} onSave={onSave} />);
    await user.keyboard('h');
    expect(onHelp).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('textbox', { name: 'Comment' }));
    await user.keyboard('h');
    expect(onHelp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('h');
    await user.keyboard('{Meta>}s{/Meta}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('uses Ctrl on Windows', async () => {
    const onSave = vi.fn();
    const { user } = renderWithProviders(<Commands onHelp={() => {}} onSave={onSave} />, { platform: 'windows' });
    await user.keyboard('{Meta>}s{/Meta}');
    expect(onSave).not.toHaveBeenCalled();
    await user.keyboard('{Control>}s{/Control}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('command palette', () => {
  it('opens with ⌘K, filters pages and actions, and runs the highlighted one with Return', async () => {
    const onNavigate = vi.fn();
    const { user } = renderWithProviders(<Shell onNavigate={onNavigate} />);
    const trigger = screen.getByRole('button', { name: 'History' });
    trigger.focus();
    await user.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    const search = within(dialog).getByRole('searchbox', { name: 'Search pages and actions' });
    expect(search).toHaveFocus();
    await expectNoA11yViolations(dialog);
    await user.keyboard('stat');
    const options = within(dialog).getAllByRole('menuitem');
    expect(options.map((option) => option.textContent)).toEqual(['Go to Statistics⌘5']);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('statistics'));
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('finds commands by keyword and closes with Escape, returning focus', async () => {
    const { user } = renderWithProviders(<Shell onNavigate={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'History' });
    act(() => trigger.focus());
    await user.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.keyboard('cheat');
    expect(within(dialog).getByRole('menuitem', { name: /Show keyboard shortcuts/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('cheat sheet', () => {
  it('opens with ? and lists every shortcut with platform keys', async () => {
    const { user } = renderWithProviders(
      <>
        <Shell onNavigate={() => {}} />
        <Commands onHelp={() => {}} onSave={() => {}} />
      </>,
      { platform: 'windows' },
    );
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const navigation = within(dialog).getByRole('table', { name: 'Navigation' });
    expect(within(navigation).getByRole('rowheader', { name: 'Go to Overview' })).toBeInTheDocument();
    expect(within(navigation).getAllByRole('row')).toHaveLength(11); // header + 10 visible pages
    expect(within(dialog).getByRole('rowheader', { name: 'Save changes' })).toBeInTheDocument();
    expect(within(dialog).getByRole('rowheader', { name: 'Show command palette' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Ctrl+K'.replace('+', ''));
    await expectNoA11yViolations(dialog);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull());
  });
});

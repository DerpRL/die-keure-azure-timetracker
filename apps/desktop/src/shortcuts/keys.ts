import type { Platform } from './platform';

/**
 * A key combination. `mod` is the platform's primary modifier: ⌘ on macOS, Ctrl on Windows and
 * Linux. `ctrl` means the literal Control key on macOS (⌃) and is ignored elsewhere.
 */
export interface KeyCombo {
  /** `KeyboardEvent.key` value: a letter, digit, symbol (`?`, `,`) or a named key (`Escape`). */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

const MAC_KEY_GLYPHS: Record<string, string> = {
  Enter: '↩',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Space',
};

const OTHER_KEY_NAMES: Record<string, string> = {
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Del',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Space',
};

const SPOKEN_KEYS: Record<string, string> = {
  Enter: 'Return',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  ArrowUp: 'Up Arrow',
  ArrowDown: 'Down Arrow',
  ArrowLeft: 'Left Arrow',
  ArrowRight: 'Right Arrow',
  ' ': 'Space',
  '?': 'Question mark',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '+': 'Plus',
  '-': 'Minus',
};

const ARIA_KEYS: Record<string, string> = { ' ': 'Space', '+': 'Plus' };

function keyLabel(key: string, platform: Platform): string {
  const table = platform === 'macos' ? MAC_KEY_GLYPHS : OTHER_KEY_NAMES;
  return table[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export interface FormattedKeyCombo {
  /** Visual parts, e.g. ['⇧', '⌘', 'D'] or ['Ctrl', 'Shift', 'D']. */
  parts: string[];
  /** Compact text: "⇧⌘D" or "Ctrl+Shift+D". */
  text: string;
  /** Spoken label: "Shift Command D" or "Control Shift D". */
  spoken: string;
  /** Value for `aria-keyshortcuts`: "Shift+Meta+D" or "Control+Shift+D". */
  aria: string;
}

export function formatKeyCombo(combo: KeyCombo, platform: Platform): FormattedKeyCombo {
  const mac = platform === 'macos';
  const parts: string[] = [];
  const spoken: string[] = [];
  const aria: string[] = [];
  if (mac) {
    // Apple's order: ⌃ ⌥ ⇧ ⌘.
    if (combo.ctrl) {
      parts.push('⌃');
      spoken.push('Control');
      aria.push('Control');
    }
    if (combo.alt) {
      parts.push('⌥');
      spoken.push('Option');
      aria.push('Alt');
    }
    if (combo.shift) {
      parts.push('⇧');
      spoken.push('Shift');
      aria.push('Shift');
    }
    if (combo.mod) {
      parts.push('⌘');
      spoken.push('Command');
      aria.push('Meta');
    }
  } else {
    if (combo.mod) {
      parts.push('Ctrl');
      spoken.push('Control');
      aria.push('Control');
    }
    if (combo.alt) {
      parts.push('Alt');
      spoken.push('Alt');
      aria.push('Alt');
    }
    if (combo.shift) {
      parts.push('Shift');
      spoken.push('Shift');
      aria.push('Shift');
    }
  }
  const label = keyLabel(combo.key, platform);
  parts.push(label);
  spoken.push(SPOKEN_KEYS[combo.key] ?? label);
  aria.push(ARIA_KEYS[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key));
  return {
    parts,
    text: mac ? parts.join('') : parts.join('+'),
    spoken: spoken.join(' '),
    aria: aria.join('+'),
  };
}

const isLetter = (key: string) => /^[a-z]$/i.test(key);
const isDigit = (key: string) => /^[0-9]$/.test(key);

function keyMatches(event: KeyboardEvent, key: string): boolean {
  if (isDigit(key)) {
    // Physical digit keys too: on AZERTY ⌘1 arrives as key "&" with code "Digit1".
    return event.key === key || event.code === `Digit${key}` || event.code === `Numpad${key}`;
  }
  if (isLetter(key)) {
    const pressed = event.key.toLowerCase();
    if (pressed === key.toLowerCase()) return true;
    // Option on macOS turns letters into symbols (⌥T → "†"); fall back to the physical key.
    return !/^[a-z]$/.test(pressed) && event.code === `Key${key.toUpperCase()}`;
  }
  return event.key === key;
}

/** Whether a keydown matches a combo on the given platform. */
export function matchesKeyCombo(event: KeyboardEvent, combo: KeyCombo, platform: Platform): boolean {
  const mac = platform === 'macos';
  const primary = mac ? event.metaKey : event.ctrlKey;
  if (Boolean(combo.mod) !== primary) return false;
  if (mac && Boolean(combo.ctrl) !== event.ctrlKey) return false;
  // The Windows key is reserved for the OS; never treat it as part of an app shortcut.
  if (!mac && event.metaKey) return false;
  if (Boolean(combo.alt) !== event.altKey) return false;
  // Symbols such as "?" need Shift on some layouts and not on others; only letters, digits and
  // named keys compare the Shift state.
  const comparesShift = combo.shift !== undefined || isLetter(combo.key) || isDigit(combo.key) || combo.key.length > 1;
  if (comparesShift && Boolean(combo.shift) !== event.shiftKey) return false;
  return keyMatches(event, combo.key);
}

export function sameKeyCombo(a: KeyCombo, b: KeyCombo): boolean {
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    Boolean(a.mod) === Boolean(b.mod) &&
    Boolean(a.shift) === Boolean(b.shift) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.ctrl) === Boolean(b.ctrl)
  );
}

/** True when the key event comes from a place where the user is typing text. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // `isContentEditable` is missing in some DOM implementations; check the attribute as well.
  if (target.isContentEditable || target.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(target.type);
  }
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton';
}

import { formatKeyCombo, type KeyCombo } from '../shortcuts/keys';
import { usePlatform } from '../shortcuts/platform';
import { cx } from '../utils/cx';
import styles from './KeyboardShortcut.module.css';

export interface KeyboardShortcutProps {
  shortcut: KeyCombo;
  /** `inline` sits inside buttons and menu rows; `standalone` is the larger cheat-sheet style. */
  variant?: 'inline' | 'standalone';
  /**
   * Hides the hint from assistive technology entirely. Use inside controls that already expose
   * the shortcut through `aria-keyshortcuts`, so it does not become part of their name.
   */
  decorative?: boolean;
  className?: string;
}

/**
 * Platform-aware shortcut hint: "⌘K" on macOS, "Ctrl+K" on Windows. The glyphs are hidden from
 * assistive technology, which reads the spoken form ("Command K") instead.
 */
export function KeyboardShortcut({ shortcut, variant = 'inline', decorative = false, className }: KeyboardShortcutProps) {
  const platform = usePlatform();
  const formatted = formatKeyCombo(shortcut, platform);
  return (
    <span className={cx(styles.shortcut, styles[variant], className)} aria-hidden={decorative || undefined}>
      <span aria-hidden="true" className={styles.keys}>
        {formatted.parts.map((part, index) => (
          <kbd key={`${part}-${index}`} className={styles.key}>
            {part}
          </kbd>
        ))}
      </span>
      {decorative ? null : <span className="visually-hidden">{formatted.spoken}</span>}
    </span>
  );
}

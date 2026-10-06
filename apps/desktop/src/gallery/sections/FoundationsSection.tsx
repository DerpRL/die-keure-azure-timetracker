import { useMemo, useSyncExternalStore } from 'react';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SeriesSwatch } from '../../charts/palette';
import { HEAT_CLASS } from '../../charts/heat';
import { contrastRatioHex, parseHexColor } from '../../theme/contrast';
import { CONTRAST_PAIRS, MINIMUM_RATIO } from '../../theme/contrastPairs';
import { useTheme } from '../../theme/ThemeProvider';
import { TrackingStatusLabel } from '../../timer/status';
import { TimerDisplay } from '../../timer/TimerDisplay';
import { GallerySection, Specimen } from '../GalleryLayout';
import styles from '../Gallery.module.css';

const THEMES = [
  { theme: 'light', contrast: 'standard', label: 'Light' },
  { theme: 'dark', contrast: 'standard', label: 'Dark' },
  { theme: 'light', contrast: 'increased', label: 'Light · increased contrast' },
  { theme: 'dark', contrast: 'increased', label: 'Dark · increased contrast' },
] as const;

const SWATCHES = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-sidebar',
  '--color-text',
  '--color-text-secondary',
  '--color-accent',
  '--color-primary',
  '--color-running',
  '--color-paused',
  '--color-warning',
  '--color-danger',
  '--color-success',
  '--color-info',
  '--color-control-border',
  '--color-focus-ring',
];

function ThemeSample() {
  return (
    <Card padding="small" className={styles.sampleCard}>
      <p className={styles.sampleTitle}>Current tracking</p>
      <p className={styles.sampleSecondary}>#33624 · Improve loading</p>
      <TimerDisplay seconds={4521} status="running" sessionId="sample" todaySeconds={3.5 * 3600} dailyTargetSeconds={27360} size="small" />
      <div className={styles.row}>
        <Button variant="primary" size="small">
          Switch ticket…
        </Button>
        <Button size="small">Pause</Button>
        <Button variant="destructive" size="small">
          Stop
        </Button>
      </div>
      <div className={styles.row}>
        <TrackingStatusLabel status="running" />
        <TrackingStatusLabel status="paused" />
        <TrackingStatusLabel status="disconnected" />
      </div>
      <div className={styles.row}>
        <Badge tone="running">Tracking</Badge>
        <Badge tone="paused">Paused</Badge>
        <Badge tone="warning">3</Badge>
        <Badge tone="danger">Failed</Badge>
      </div>
      <Banner tone="warning" title="Connection lost" live="off">
        Last confirmed 2 minutes ago.
      </Banner>
      <div className={styles.row} aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <SeriesSwatch key={index} index={index} />
        ))}
        {HEAT_CLASS.map((className, index) => (
          <span key={index} className={`${styles.heatChip} ${className ?? ''}`} />
        ))}
      </div>
    </Card>
  );
}

/** Changes whenever the theme attributes on <html> change (after the provider applied them). */
function subscribeRootTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-contrast'] });
  return () => observer.disconnect();
}
const rootThemeKey = () => `${document.documentElement.dataset.theme ?? ''}|${document.documentElement.dataset.contrast ?? ''}`;

function ContrastTable() {
  const { resolved } = useTheme();
  const themeKey = useSyncExternalStore(subscribeRootTheme, rootThemeKey, rootThemeKey);
  const rows = useMemo(() => {
    // Values are read from the live custom properties of the applied theme (`themeKey`).
    void themeKey;
    const style = getComputedStyle(document.documentElement);
    return CONTRAST_PAIRS.map((pair) => {
      const fg = style.getPropertyValue(pair.fg).trim();
      const bg = style.getPropertyValue(pair.bg).trim();
      const minimum = MINIMUM_RATIO[pair.kind][resolved.contrast === 'increased' ? 'increased' : 'standard'];
      const ratio = parseHexColor(fg) && parseHexColor(bg) ? contrastRatioHex(fg, bg) : null;
      return { ...pair, fgValue: fg, bgValue: bg, ratio, minimum };
    }).filter((row) => row.minimum > 0);
  }, [themeKey, resolved.contrast]);
  return (
    <div className={styles.tableScroll}>
      <table className={styles.contrastTable}>
        <caption>
          Contrast in the current theme ({resolved.theme}, {resolved.contrast}); checked in CI by contrast.test.ts
        </caption>
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col">Use</th>
            <th scope="col">Ratio</th>
            <th scope="col">Needs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.fg}-${row.bg}`}>
              <th scope="row">
                <span className={styles.pairSample} style={{ color: `var(${row.fg})`, background: `var(${row.bg})` }}>
                  Aa
                </span>{' '}
                <code>{row.fg}</code> on <code>{row.bg}</code>
              </th>
              <td>{row.usage}</td>
              <td>{row.ratio === null ? 'system colour' : `${row.ratio.toFixed(2)}:1`}</td>
              <td>{`${row.minimum}:1`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FoundationsSection() {
  return (
    <GallerySection
      id="foundations"
      title="Foundations"
      description="Tokens drive every colour, size and motion. The matrix renders the same sample in all four themes at once; scale and motion follow the controls above."
    >
      <Specimen title="Theme matrix" wide>
        <div className={styles.matrix}>
          {THEMES.map(({ theme, contrast, label }) => (
            <div key={label} data-theme={theme} data-contrast={contrast} className={styles.matrixCell}>
              <p className={styles.matrixLabel}>{label}</p>
              <ThemeSample />
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen title="Colour tokens" wide>
        <ul role="list" className={styles.swatches}>
          {SWATCHES.map((name) => (
            <li key={name} className={styles.swatchItem}>
              <span className={styles.swatchColor} style={{ background: `var(${name})` }} aria-hidden="true" />
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </Specimen>
      <Specimen title="Contrast pairs" wide>
        <ContrastTable />
      </Specimen>
      <Specimen title="Type scale" wide>
        <div className={styles.typeScale}>
          <p style={{ fontSize: 'var(--font-size-title-1)', fontWeight: 700, fontFamily: 'var(--font-family-rounded)' }}>Title 1 · Today</p>
          <p style={{ fontSize: 'var(--font-size-title-2)', fontWeight: 600 }}>Title 2 · Statistics</p>
          <p style={{ fontSize: 'var(--font-size-title-3)', fontWeight: 600 }}>Title 3 · Current tracking</p>
          <p style={{ fontSize: 'var(--font-size-headline)', fontWeight: 600 }}>Headline · Today’s time</p>
          <p>Body · Choose a ticket, or switch branches to get a suggestion.</p>
          <p style={{ fontSize: 'var(--font-size-footnote)', color: 'var(--color-text-secondary)' }}>
            Footnote · Tokens stay in Keychain. Your Git repositories stay untouched.
          </p>
          <p style={{ fontSize: 'var(--font-size-caption)', color: 'var(--color-text-secondary)' }}>Caption · Last known · 39% of daily target</p>
        </div>
      </Specimen>
    </GallerySection>
  );
}

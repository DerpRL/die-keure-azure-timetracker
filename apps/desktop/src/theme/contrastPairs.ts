/**
 * The colour pairs the UI actually draws, with their WCAG 2.2 requirement. `contrast.test.ts`
 * checks every pair in every theme against the values in `tokens.css`.
 *
 * - `text`: SC 1.4.3, 4.5:1 (7:1 in the increased-contrast themes, which aim for AAA).
 * - `ui`: SC 1.4.11, 3:1 for component boundaries, states, focus indicators and chart marks.
 * - `increased-ui`: only required in increased contrast (stronger section borders, as in 1.14).
 */
export type ContrastKind = 'text' | 'ui' | 'increased-ui';

export interface ContrastPair {
  fg: string;
  bg: string;
  kind: ContrastKind;
  /** Where the pair is used, for test failure messages. */
  usage: string;
}

const surfaces = ['--color-bg', '--color-surface', '--color-surface-raised', '--color-sidebar'] as const;

function across(fg: string, bgs: readonly string[], kind: ContrastKind, usage: string): ContrastPair[] {
  return bgs.map((bg) => ({ fg, bg, kind, usage }));
}

const statusForegrounds = [
  '--color-running',
  '--color-paused',
  '--color-warning',
  '--color-danger',
  '--color-success',
  '--color-info',
  '--color-neutral',
] as const;

const statusTones = ['running', 'paused', 'warning', 'danger', 'success', 'info', 'neutral'] as const;

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // Body text on every surface it can sit on.
  ...across(
    '--color-text',
    [
      ...surfaces,
      '--color-surface-sunken',
      '--color-field-bg',
      '--color-hover',
      '--color-pressed',
      '--color-selected-bg',
    ],
    'text',
    'body text',
  ),
  ...across(
    '--color-text-secondary',
    [...surfaces, '--color-surface-sunken', '--color-field-bg', '--color-hover'],
    'text',
    'secondary text',
  ),
  ...across('--color-accent', [...surfaces, '--color-hover', '--color-accent-bg'], 'text', 'links and accent text'),
  { fg: '--color-selected-text', bg: '--color-selected-bg', kind: 'text', usage: 'selected navigation item' },

  // Buttons.
  ...across(
    '--color-on-primary',
    ['--color-primary', '--color-primary-hover', '--color-primary-pressed'],
    'text',
    'primary button label',
  ),
  ...across(
    '--color-secondary-text',
    ['--color-secondary-bg', '--color-secondary-hover', '--color-secondary-pressed'],
    'text',
    'secondary button label',
  ),
  ...across('--color-on-danger', ['--color-danger-solid', '--color-danger-solid-hover'], 'text', 'destructive button'),

  // Status colours are used as text labels and icons on surfaces.
  ...statusForegrounds.flatMap((fg) => across(fg, surfaces, 'text', 'status label')),
  // Badges and banners: tinted solid backgrounds with their own text colour and body text.
  ...statusTones.flatMap((tone): ContrastPair[] => [
    { fg: `--color-${tone}-text`, bg: `--color-${tone}-bg`, kind: 'text', usage: `${tone} badge/banner title` },
    { fg: '--color-text', bg: `--color-${tone}-bg`, kind: 'text', usage: `${tone} banner body` },
    { fg: `--color-${tone}`, bg: `--color-${tone}-bg`, kind: 'ui', usage: `${tone} banner icon` },
  ]),
  { fg: '--color-tooltip-text', bg: '--color-tooltip-bg', kind: 'text', usage: 'tooltip' },
  { fg: '--color-on-brand-tile', bg: '--color-brand-tile', kind: 'ui', usage: 'app icon tile' },
  { fg: '--color-selected-text', bg: '--color-surface', kind: 'text', usage: 'selected segment' },
  ...across('--color-selected-indicator', ['--color-surface-sunken'], 'ui', 'selected segment border'),
  ...across('--color-danger', ['--color-hover'], 'text', 'destructive menu item'),

  // Heatmap cell labels.
  ...across('--heat-on-low', ['--heat-0', '--heat-1', '--heat-2'], 'text', 'heatmap label (low)'),
  ...across('--heat-on-high', ['--heat-3', '--heat-4', '--heat-5'], 'text', 'heatmap label (high)'),

  // Component boundaries and states (SC 1.4.11).
  ...across('--color-control-border', [...surfaces, '--color-field-bg'], 'ui', 'field and control border'),
  ...across(
    '--color-focus-ring',
    [...surfaces, '--color-selected-bg', '--color-hover', '--color-surface-sunken'],
    'ui',
    'focus ring',
  ),
  ...across('--color-selected-indicator', ['--color-selected-bg', '--color-sidebar'], 'ui', 'selection indicator'),
  ...across('--color-check-bg', surfaces, 'ui', 'checked checkbox'),
  { fg: '--color-check-mark', bg: '--color-check-bg', kind: 'ui', usage: 'checkmark' },
  ...across('--color-switch-on', surfaces, 'ui', 'switch track (on)'),
  ...across('--color-switch-off', surfaces, 'ui', 'switch track (off)'),
  { fg: '--color-switch-thumb-on', bg: '--color-switch-on', kind: 'ui', usage: 'switch thumb (on)' },
  { fg: '--color-switch-thumb-off', bg: '--color-switch-off', kind: 'ui', usage: 'switch thumb (off)' },
  // The ring track itself is decorative; the progress arc must stand out from it.
  ...['--color-running','--color-paused', '--color-warning', '--color-neutral'].map(
    (fg): ContrastPair => ({ fg, bg: '--color-ring-track', kind: 'ui', usage: 'timer ring arc on its track' }),
  ),

  // Charts: every series colour against the card it is drawn on, plus axes and reference lines.
  ...Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`).flatMap((fg) =>
    across(fg, ['--color-surface', '--color-bg', '--color-surface-raised'], 'ui', 'chart series'),
  ),
  ...across('--chart-axis', ['--color-surface'], 'ui', 'chart axis'),
  ...across('--chart-target', ['--color-surface'], 'ui', 'chart target line'),
  ...across('--chart-rule', ['--color-surface'], 'ui', 'chart hover rule'),
  ...across('--heat-future-border', ['--color-surface'], 'ui', 'future day outline'),

  // Increased contrast strengthens section borders and separators.
  ...across('--color-border', ['--color-bg', '--color-surface'], 'increased-ui', 'card border'),
  ...across('--color-separator', ['--color-surface', '--color-sidebar'], 'increased-ui', 'separator'),
];

export const MINIMUM_RATIO: Record<ContrastKind, { standard: number; increased: number }> = {
  text: { standard: 4.5, increased: 7 },
  ui: { standard: 3, increased: 3 },
  'increased-ui': { standard: 0, increased: 3 },
};

import { describe, expect, it } from 'vitest';
import tokensCss from './tokens.css?raw';
import { contrastRatioHex, parseHexColor } from './contrast';
import { CONTRAST_PAIRS, MINIMUM_RATIO } from './contrastPairs';
import { findBlock, parseCssBlocks } from '../test/cssBlocks';

const blocks = parseCssBlocks(tokensCss);

const THEMES = {
  light: { selector: ":root, [data-theme='light']", increased: false, standardTwin: null },
  dark: { selector: "[data-theme='dark']", increased: false, standardTwin: null },
  'light-increased': {
    selector: "[data-theme='light'][data-contrast='increased']",
    increased: true,
    standardTwin: 'light',
  },
  'dark-increased': {
    selector: "[data-theme='dark'][data-contrast='increased']",
    increased: true,
    standardTwin: 'dark',
  },
} as const;
type ThemeName = keyof typeof THEMES;
const themeNames = Object.keys(THEMES) as ThemeName[];

function themeTokens(name: ThemeName): Map<string, string> {
  const block = findBlock(blocks, THEMES[name].selector);
  if (!block) throw new Error(`Missing theme block ${THEMES[name].selector}`);
  return block.declarations;
}

const isColourToken = (name: string) => /^--(color|chart|heat)-/.test(name);
/** Translucent by design: the modal scrim is not a text background. */
const TRANSLUCENT_ALLOWED = new Set(['--color-backdrop']);

function colourTokenNames(name: ThemeName): string[] {
  return [...themeTokens(name).keys()].filter(isColourToken).sort();
}

function ratio(theme: ThemeName, fg: string, bg: string): number {
  const tokens = themeTokens(theme);
  const fgValue = tokens.get(fg);
  const bgValue = tokens.get(bg);
  if (!fgValue || !bgValue) throw new Error(`${theme}: ${fg} or ${bg} is not defined`);
  return contrastRatioHex(fgValue, bgValue);
}

/** OKLab, for a perceptual distance between categorical chart colours. */
function oklab(hex: string): [number, number, number] {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`Not a hex colour: ${hex}`);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(rgb.r), lin(rgb.g), lin(rgb.b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

describe('design tokens', () => {
  it('defines all four colour themes with the same complete token set', () => {
    const reference = colourTokenNames('light');
    expect(reference.length).toBeGreaterThan(80);
    for (const theme of themeNames) expect(colourTokenNames(theme), theme).toEqual(reference);
  });

  it('maps every colour token to a system colour in forced-colors mode', () => {
    const forced = findBlock(blocks, '@media (forced-colors: active)', ':root, [data-theme]');
    expect(forced).toBeDefined();
    const names = [...(forced?.declarations.keys() ?? [])].filter(isColourToken).sort();
    expect(names).toEqual(colourTokenNames('light'));
    for (const [name, value] of forced?.declarations ?? []) {
      if (isColourToken(name)) expect(value, name).not.toMatch(/#|rgb|hsl/i);
    }
  });

  it('uses solid colours for every surface, text and mark', () => {
    for (const theme of themeNames) {
      for (const [name, value] of themeTokens(theme)) {
        if (!isColourToken(name) || TRANSLUCENT_ALLOWED.has(name)) continue;
        expect(parseHexColor(value), `${theme} ${name}: ${value}`).not.toBeNull();
      }
    }
  });

  it('keeps primary buttons dark teal with white text', () => {
    for (const theme of themeNames) {
      const tokens = themeTokens(theme);
      expect(tokens.get('--color-on-primary'), theme).toBe('#ffffff');
      const primary = parseHexColor(tokens.get('--color-primary') ?? '');
      expect(primary, theme).not.toBeNull();
      if (!primary) continue;
      // Teal: green and blue dominate red, and the fill is dark.
      expect(primary.g, theme).toBeGreaterThan(primary.r * 3);
      expect(primary.b, theme).toBeGreaterThan(primary.r * 3);
      expect(contrastRatioHex('#ffffff', tokens.get('--color-primary') ?? ''), theme).toBeGreaterThanOrEqual(4.5);
    }
  });

  describe.each(themeNames)('%s theme', (theme) => {
    const { increased } = THEMES[theme];
    it.each(CONTRAST_PAIRS.map((pair) => [`${pair.fg} on ${pair.bg} (${pair.usage})`, pair] as const))(
      'meets WCAG 2.2 AA: %s',
      (_label, pair) => {
        const minimum = MINIMUM_RATIO[pair.kind][increased ? 'increased' : 'standard'];
        if (minimum === 0) return;
        const value = ratio(theme, pair.fg, pair.bg);
        expect(value, `${theme}: ${pair.fg} on ${pair.bg} is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum);
      },
    );
  });

  it('never weakens a pair in increased contrast', () => {
    const weaker: string[] = [];
    for (const theme of themeNames) {
      const twin = THEMES[theme].standardTwin;
      if (!twin) continue;
      for (const pair of CONTRAST_PAIRS) {
        if (pair.kind === 'increased-ui') continue;
        const increased = ratio(theme, pair.fg, pair.bg);
        const standard = ratio(twin, pair.fg, pair.bg);
        if (increased + 0.05 < standard) {
          weaker.push(`${theme} ${pair.fg} on ${pair.bg}: ${increased.toFixed(2)} < ${standard.toFixed(2)}`);
        }
      }
    }
    expect(weaker).toEqual([]);
  });

  it('keeps the eight activity colours perceptually distinct in every theme', () => {
    for (const theme of themeNames) {
      const tokens = themeTokens(theme);
      const colours = Array.from({ length: 8 }, (_, i) => oklab(tokens.get(`--chart-${i + 1}`) ?? ''));
      for (let i = 0; i < colours.length; i++) {
        for (let j = i + 1; j < colours.length; j++) {
          const [a, b] = [colours[i], colours[j]];
          if (!a || !b) continue;
          const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          expect(distance, `${theme}: --chart-${i + 1} vs --chart-${j + 1}`).toBeGreaterThan(0.08);
        }
      }
    }
  });
});

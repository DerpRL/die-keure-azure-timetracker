/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fill, resolveLanguage, setLanguage, t, tn } from './index';
import { AREAS, NL } from './nl';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'fixtures' || name === 'i18n' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'generated.ts' ? [path] : [];
  });
}

const STRING = String.raw`(['"])((?:\\.|(?!\1).)*?)\1`;
const SINGLE = new RegExp(String.raw`\b(?:t|mark)\(\s*${STRING}`, 'gs');
const PLURAL = new RegExp(String.raw`\btn\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*${STRING}\s*,\s*${STRING.replace('\\1', '\\3')}`, 'gs');

function unescape(text: string): string {
  return text.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));
}

/**
 * Every English key passed to `t`, `tn` and `mark` with a plain string literal. `I18N_SCOPE`
 * (comma-separated paths under `src/`, such as `places/today,charts`) limits the check to those
 * folders while an area is being translated.
 */
function sourceKeys(): Set<string> {
  const keys = new Set<string>();
  const scope = (process.env.I18N_SCOPE ?? '').split(',').filter(Boolean).map((path) => join(SRC, path));
  const files = sourceFiles(SRC).filter((file) => scope.length === 0 || scope.some((path) => file.startsWith(path)));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(SINGLE)) keys.add(unescape(match[2]!));
    for (const match of text.matchAll(PLURAL)) {
      keys.add(unescape(match[2]!));
      keys.add(unescape(match[4]!));
    }
  }
  return keys;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('the Dutch catalog', () => {
  it('has an entry for every key in the source', () => {
    const missing = [...sourceKeys()].filter((key) => !(key in NL));
    expect(missing).toEqual([]);
  });

  it('keeps every placeholder and translates every entry', () => {
    const problems = Object.entries(NL).filter(([english, dutch]) => !dutch.trim() || placeholders(english).join() !== placeholders(dutch).join());
    expect(problems).toEqual([]);
  });

  it('translates a key listed in two areas the same way in both', () => {
    const seen = new Map<string, { area: string; dutch: string }>();
    const differ: string[] = [];
    for (const [area, entries] of Object.entries(AREAS))
      for (const [key, dutch] of Object.entries(entries)) {
        const earlier = seen.get(key);
        if (earlier && earlier.dutch !== dutch) differ.push(`${key}: “${earlier.dutch}” (${earlier.area}) vs “${dutch}” (${area})`);
        seen.set(key, { area, dutch });
      }
    expect(differ).toEqual([]);
  });
});

describe('t', () => {
  it('translates, fills placeholders and falls back to English', () => {
    expect(fill('{a} of {b}', { a: 1 })).toBe('1 of {b}');
    setLanguage('nl');
    try {
      expect(t('Language')).toBe('Taal');
      expect(t('Not in the catalog {x}', { x: 2 })).toBe('Not in the catalog 2');
      expect(tn(1, '{count} minute', '{count} minutes')).toBe('1 minuut');
      expect(tn(3, '{count} minute', '{count} minutes')).toBe('3 minuten');
    } finally {
      setLanguage('en');
    }
    expect(t('Language')).toBe('Language');
  });

  it('resolves the system language from its tag', () => {
    expect(resolveLanguage('system', 'nl-BE')).toBe('nl');
    expect(resolveLanguage(undefined, 'en-US')).toBe('en');
    expect(resolveLanguage('en', 'nl-BE')).toBe('en');
    expect(resolveLanguage('nl', 'fr-BE')).toBe('nl');
  });
});

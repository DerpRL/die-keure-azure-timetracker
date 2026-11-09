/**
 * The interface language: English or Dutch (Settings → Appearance → Language).
 *
 * English is the source language and the lookup key, gettext style. Code keeps writing English
 * and wraps it: `t('Add time')`, `t('{count} entries', { count })`, `tn(count, '{count} draft',
 * '{count} drafts')`. The Dutch catalogs in `./nl/` map that English text to Dutch; a string with
 * no entry stays English, so a missing translation never breaks the interface. Placeholders are
 * named (`{name}`) so a Dutch sentence can put them where Dutch needs them.
 *
 * The language is per window and global: `LanguageBoundary` sets it before its children render
 * and remounts them when it changes, so plain functions (labels, formatters) can call `t` too.
 * Tests and the gallery render without a boundary and get English.
 *
 * Dates and numbers follow `locale()`: `en-GB` (24-hour clock, day-month order, Monday first,
 * as 1.14 users in Belgium saw) or `nl-BE`.
 */
import { NL } from './nl';

export type Language = 'en' | 'nl';
export type LanguagePreference = 'system' | Language;

export const LANGUAGE_PREFERENCES = ['system', 'en', 'nl'] as const satisfies readonly LanguagePreference[];

let current: Language = 'en';
let remounted = false;

/** `LanguageBoundary` remounted its children for a new language (not a first mount). */
export function noteLanguageRemount(): void {
  remounted = true;
}

/** Whether this mount comes from a language change; reading it resets it. */
export function takeLanguageRemount(): boolean {
  const value = remounted;
  remounted = false;
  return value;
}

/** The language `t` translates to from now on. */
export function setLanguage(language: Language): void {
  current = language;
}

export function language(): Language {
  return current;
}

/** The BCP 47 locale for dates, numbers and React Aria. */
export function locale(language: Language = current): string {
  return language === 'nl' ? 'nl-BE' : 'en-GB';
}

/** Dutch for any `nl` tag (`nl`, `nl-BE`, `nl-NL`), English otherwise. */
export function languageFromTag(tag: string | null | undefined): Language {
  return (tag ?? '').toLowerCase().split(/[-_]/)[0] === 'nl' ? 'nl' : 'en';
}

/** The language a preference resolves to, with `system` the system's first language. */
export function resolveLanguage(preference: LanguagePreference | null | undefined, systemTag: string | null | undefined): Language {
  if (preference === 'en' || preference === 'nl') return preference;
  return languageFromTag(systemTag);
}

export type Vars = Readonly<Record<string, string | number | null | undefined>>;

/** Fills `{name}` placeholders; unknown ones stay as they are. */
export function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** `english` in the interface language, with its placeholders filled. */
export function t(english: string, vars?: Vars): string {
  const text = current === 'nl' ? (NL[english] ?? english) : english;
  return fill(text, vars);
}

/**
 * `english` in the interface language where the same English means something else elsewhere:
 * the catalog entry `"{context}|{english}"` wins over the plain one ("key|Period" is the "."
 * key, "Period" the Insights period).
 */
export function tc(context: string, english: string, vars?: Vars): string {
  if (current === 'nl') {
    const specific = NL[`${context}|${english}`];
    if (specific !== undefined) return fill(specific, vars);
  }
  return t(english, vars);
}

/**
 * The singular or plural form for `count` (both languages have just these two), translated and
 * filled; `{count}` is available to both forms.
 */
export function tn(count: number, one: string, other: string, vars?: Vars): string {
  return t(count === 1 ? one : other, { count, ...vars });
}

/**
 * Marks English text for the catalog without translating it yet, for constants built at import
 * time: translate where it is shown, with `t(value)`.
 */
export function mark<T extends string>(english: T): T {
  return english;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * A date formatter in the interface locale, cached per language and options. Call it where the
 * text is built, not at import time: a module-level formatter would keep the first language.
 */
export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${current}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale(), options);
    dateFormats.set(key, format);
  }
  return format;
}

/** A number formatter in the interface locale, cached like `dateFormat`. */
export function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${current}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale(), options);
    numberFormats.set(key, format);
  }
  return format;
}

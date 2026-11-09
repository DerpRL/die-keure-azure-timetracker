/**
 * The Dutch catalog: English source text → Dutch. One file per area of the interface, merged
 * here; keys are the exact English strings passed to `t` / `tn` / `mark`, placeholders included.
 * `catalog.test.ts` checks that every key in the source has an entry with the same placeholders.
 *
 * Conventions (Belgian Dutch, informal "je"): see `README.md` in this folder.
 */
import { settings } from './settings';
import { timesheet } from './timesheet';
import { insights } from './insights';
import { features } from './features';
import { shell } from './shell';
import { shared } from './shared';

export const NL: Readonly<Record<string, string>> = Object.freeze({
  ...shared,
  ...settings,
  ...timesheet,
  ...insights,
  ...features,
  ...shell,
});

/** The area files, for the catalog test (a key listed in two areas is reported). */
export const AREAS: Readonly<Record<string, Record<string, string>>> = { shared, settings, timesheet, insights, features, shell };

# Dutch translation guide

How Azure timetracker is translated into Dutch, for both the React UI (`apps/desktop/src`) and the
Rust engine (`crates/*`, `apps/desktop/src-tauri`). English stays the source text and the lookup
key; a string without a Dutch entry shows in English.

## Voice

Belgian Dutch, informal **je/jouw**, short and plain, like the English. Buttons and menu items use
the infinitive ("Opslaan", "Tijd toevoegen", "Registratie starten"), as macOS and Windows do in
Dutch. Sentences end with a full stop where the English does. Keep typographic quotes “ ” and the
ellipsis … where the English has them.

## Glossary

| English | Dutch |
|---|---|
| track, tracking (time) | registreren, registratie (tijdregistratie) |
| Start tracking / Stop tracking | Registratie starten / Registratie stoppen |
| timer | timer |
| running | loopt (the timer *loopt*), actief |
| pause / resume | pauzeren / hervatten |
| entry, worklog, time entry | boeking (tijdboeking) |
| tracked time, recorded time | geregistreerde tijd |
| ticket, work item | ticket |
| activity | activiteit |
| comment | opmerking |
| billable | factureerbaar |
| draft, offline draft | concept, offline concept |
| local timer | lokale timer |
| gap / overlap | gat / overlap |
| split / merge | splitsen / samenvoegen |
| undo / Recent edits | ongedaan maken / Recente wijzigingen |
| Today | Vandaag |
| Timesheet | Urenstaat |
| Insights | Inzichten |
| Statistics | Statistieken |
| Weekly report | Weekrapport |
| Day review / Day check | Dagcontrole |
| Agenda | Agenda |
| History | Geschiedenis |
| Time editor | Tijdeditor |
| Week so far | Week tot nu toe |
| target (daily/weekly hours) | doel (dagdoel, weekdoel) |
| Settings | Instellingen |
| Save changes | Wijzigingen opslaan |
| account, sign in | account, aanmelden |
| workspace | werkruimte |
| token, PAT, PIN | token, PAT, pincode |
| connected / disconnected | verbonden / niet verbonden |
| branch, repository, worktree | branch, repository, worktree |
| meeting, stand-up, daily standup | vergadering, stand-up, daily stand-up |
| microphone | microfoon |
| suggestion, prompt | suggestie, melding |
| notification | melding |
| quick switch | snel wisselen |
| shortcut | sneltoets |
| menu bar / notification area | menubalk / systeemvak |
| update, install | update, installeren |
| Cancel / Close / Done / Retry | Annuleren / Sluiten / Klaar / Opnieuw proberen |
| Keep tracking / Keep current | Blijven registreren / Huidige behouden |
| idle, inactive | inactief |
| holiday | feestdag |
| Mon, Tue … (short days) | from `dateFormat`, never hand-written |

Product and proper names stay as they are: 7pace, Azure DevOps, Azure, Figma, Slack, Teams, Zoom,
Google Meet, Git, macOS, Windows, Keychain ("sleutelhanger" only in running text about macOS),
Credential Manager. Keyboard keys (⌘, Ctrl, Shift) stay.

Durations are "3u 20m" in Dutch (`utils/duration.ts`); dates and times come from `dateFormat` /
`numberFormat` in the `nl-BE` locale.

## React UI rules

- Wrap every visible English string — JSX text, `aria-label`, `title`, `placeholder`, `label`,
  `description`, button labels, banner/toast text, command palette labels and group names,
  `useAnnouncer` messages, `document.title` — in `t('…')` from `src/i18n`.
- The key is always a **plain string literal** inside the call: `t('Add time')`. Never a template
  literal, a variable or a concatenation. Dynamic parts become named placeholders:
  `t('{done} of {total}', { done, total })`.
- Plurals: `tn(count, '{count} draft', '{count} drafts')`. Never build plurals with `s`.
- Never call `t` at module level (constants evaluated on import keep English). Label maps defined
  at module level wrap their values in `mark('…')` and are translated where shown: `t(LABELS[id])`.
- Dates and numbers: replace `new Intl.DateTimeFormat('en-GB', options)` and
  `toLocale…String('en-GB', options)` with `dateFormat(options).format(date)` (and
  `numberFormat(options)`), called where the text is built, not at module level.
- Do **not** translate: text that comes from the engine in a slice (the engine translates it),
  user data (ticket titles, comments, calendar events, file names), serialized values, IDs,
  product names, CSS class names, `data-*` values, console messages, and strings the code
  compares against. When the code compares engine text (for example `title.includes('attention')`),
  say so in your report instead of guessing.
- Engine values that are raw enum strings shown as-is (an offline draft's `status`, such as
  `'Local draft'`) are translated where shown, through a `mark()` label map.
- English output must not change: the tests run in English and must keep passing unchanged.
- Add the Dutch for every key to your area's file in `src/i18n/nl/`. Check with
  `I18N_SCOPE=<your folders> npx vitest run src/i18n`.

## Rust rules

- Each crate has its catalog in `src/nl.rs` (`att-engine`: `src/nl/session.rs` and
  `src/nl/controllers.rs`). Translate with `crate::nl::tr("…")` for fixed text and
  `crate::nl::trf("…{name}…", &[("name", &value)])` for text with values;
  `format!("Ticket #{} …", id)` becomes `trf("Ticket #{id} …", &[("id", &id)])`.
- The key is a plain string literal in the call (line continuations with `\` are fine).
- Translate what a person reads: messages in `AppError::message`/`AppError::Message`, prompt
  titles and buttons, notification text, tray menu and tooltip text, slice text (statuses,
  labels, hints, issues), audit entries, generated report text.
- Do **not** translate: `tracing` messages, error `kind`s, serialized enum raw values and keys
  (Swift-compatible values such as an offline draft status), IDs, file names, HTTP headers, test
  fixtures, and text the UI or other code compares or parses. Check with `rg` in
  `apps/desktop/src` before translating text that might be compared.
- Existing tests run in English and must keep passing unchanged. Use
  `att_core::i18n::with_language(Language::Nl, || …)` for a Dutch test.
- `cargo test -p <crate>` runs the catalog test (`nl::tests`), which fails on any key without a
  Dutch entry or with different placeholders.

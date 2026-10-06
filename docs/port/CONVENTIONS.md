# Porting conventions (Swift 1.14.2 → Rust 2.0)

Every porting task follows these rules. The Swift sources are the specification:
`Sources/AzureTimetrackerCore/*.swift`, `Tests/AzureTimetrackerCoreTests/*.swift`, and for app
behaviour `Sources/AzureTimetracker/*.swift`.

## Behaviour

- Port behaviour exactly, including odd-looking rules. Add a short comment when a rule is
  surprising. User-facing strings are copied verbatim from Swift.
- Do not port dead code: Slack huddles (`SlackHuddles.swift`), `DetailedStatistics.swift`, the
  update installer (`AppUpdates.swift`, `UpdateInstallation.swift`, `UpdateTrust.swift`).

## Types

- Swift `Int` → `i64`; `Double`/`TimeInterval` → `f64` seconds; `Int32.max` bounds →
  `i32::MAX as i64`. Swift `UUID` → `uuid::Uuid`. `Set<T>` → `BTreeSet<T>`.
- Instants are `jiff::Timestamp`. Calendar arithmetic goes through `att_core::Cal`. Core code
  never reads the system clock or zone: take `now: Timestamp` and `cal: &Cal` parameters. The
  Swift → Rust translation table is at the top of `crates/att-core/src/time.rs`.
- Errors are `att_core::AppError`. Async services are the `#[async_trait]` traits in
  `att_core::service`.
- Regexes: `fancy_regex` (ICU-style lookaround). Compile once per value, not per call, on hot paths.
- Text: `att_core::text::{NonEmpty, fold, contains_folded, natural_cmp}` replace Swift `nonEmpty`,
  case/diacritic-insensitive matching and `localizedStandardCompare`.
- English only. Swift `Date.formatted`/`calendar.shortWeekdaySymbols` become fixed English formats.

## Serialization (critical for migrating 1.14.x data)

Types the Swift app persisted must decode the exact JSON it wrote. That is everything reachable
from `SavedState` (`Sources/AzureTimetracker/LocalServices.swift`), plus `offline-drafts.json`,
`time-edit-history.json` and `weekly-report-drafts.json`.

- `#[serde(rename_all = "camelCase")]` for writes. Add `#[serde(alias = "<SwiftKey>")]` when the
  Swift property name differs from the camelCase form, e.g. `ticketID`, `activityID`, `workspaceID`.
- `Timestamp` fields: `#[serde(with = "crate::time::flex_date")]`. `Option<Timestamp>`:
  `#[serde(default, with = "crate::time::flex_date::option")]`. Swift `[String: Date]`:
  `BTreeMap<String, Timestamp>` with `#[serde(with = "crate::time::flex_date::map")]`.
  These write RFC 3339 and read both RFC 3339 and Swift's seconds-since-2001 numbers.
- Enums with `String` raw values serialize as the exact raw value (`#[serde(rename = "Local draft")]`).
  Enums without raw values encode as the case name (`"apiToken"`). Swift enums with associated
  values use Swift's synthesized shape (`{"case":{"_0":…}}` or labelled fields); replicate it with
  custom serde if persisted.
- Swift dictionaries keyed by `String` or `Int` encode as JSON objects (Int keys become strings).
  Other key types (UUID, enums) encode as flat arrays `[k1, v1, k2, v2]`. Check before porting.
- Missing optional keys must decode as `None`. Prefer `#[serde(default)]` over failing when a
  sensible default exists. Swift types with tolerant custom `init(from:)` stay tolerant.
- Each persisted type gets at least one test that decodes hand-written Swift-format JSON.

## Tests

- Port every Swift test in scope. Put them in `crates/<crate>/tests/<swift_test_file_snake>.rs`;
  use in-module `#[cfg(test)]` tests only for private items. Keep the Swift test name in
  snake_case. Parameterised Swift tests become one Rust test looping over the cases, with the case
  in the assertion message.
- Pin `Cal::brussels()` where Swift pinned `Europe/Brussels`, and also where Swift relied on the
  machine's current zone.
- Async tests use `#[tokio::test]`. Fakes live in the test file or `tests/support/`.
- Record traceability in `docs/port/<area>.md`: Swift `File › Suite › test` | Rust `file::test` |
  ported / adapted / not ported + reason.

## Hygiene

- Only edit files in your scope. Request other changes in your report.
- `cargo fmt`, `cargo clippy -p <crate> --all-targets -- -D warnings` and `cargo test -p <crate>`
  must pass. No `unwrap()`/`expect()` in non-test code unless it guards an invariant, with a comment.
- Commit on your branch. End the message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

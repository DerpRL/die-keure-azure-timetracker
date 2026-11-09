//! The interface language (English or Dutch) for text the engine builds: prompts, errors,
//! notifications, the tray tooltip and every other string a slice carries.
//!
//! English is the source language and the lookup key, gettext style: code keeps writing English
//! (`tr("Branch changed")`), and each crate keeps its own Dutch catalog next to its code (see
//! [`catalog!`]). A string without a Dutch entry stays English, so a missing translation never
//! breaks anything; each crate's `tests/i18n_catalog.rs` fails on keys without an entry.
//! Placeholders are named, `{name}`, and filled by [`fill`] after the lookup so the Dutch
//! sentence can put them where Dutch needs them.
//!
//! The language is process-wide: the engine sets it from the saved preference (and the system
//! language the window reports for "System"), and text built afterwards uses it. Tests switch
//! it for their own thread only with [`with_language`].

use std::cell::Cell;
use std::collections::{BTreeSet, HashMap};
use std::fmt::Display;
use std::path::Path;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};

/// A language the interface is available in.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Nl,
}

impl Language {
    pub const ALL: [Self; 2] = [Self::En, Self::Nl];

    pub fn raw(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Nl => "nl",
        }
    }

    pub fn from_raw(raw: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|language| language.raw() == raw)
    }

    /// The language of a BCP 47 tag such as `nl-BE` or `en_US`: Dutch for any `nl` tag, English
    /// otherwise.
    pub fn from_tag(tag: &str) -> Self {
        let primary = tag.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
        if primary == "nl" { Self::Nl } else { Self::En }
    }
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

thread_local! {
    static OVERRIDE: Cell<Option<Language>> = const { Cell::new(None) };
}

/// The language text is built in from now on.
pub fn set_language(language: Language) {
    CURRENT.store(language as u8, Ordering::Relaxed);
}

pub fn language() -> Language {
    if let Some(language) = OVERRIDE.with(Cell::get) {
        return language;
    }
    if CURRENT.load(Ordering::Relaxed) == Language::Nl as u8 { Language::Nl } else { Language::En }
}

/// Runs `f` with `language` on this thread only, for tests: parallel tests never see it.
pub fn with_language<R>(language: Language, f: impl FnOnce() -> R) -> R {
    let previous = OVERRIDE.with(|cell| cell.replace(Some(language)));
    let result = f();
    OVERRIDE.with(|cell| cell.set(previous));
    result
}

type Table = &'static [(&'static str, &'static str)];

/// A Dutch catalog: English source text → Dutch, from one or more tables (a crate can keep one
/// table per area so the areas can be edited separately).
pub struct Catalog {
    tables: &'static [Table],
    map: OnceLock<HashMap<&'static str, &'static str>>,
}

impl Catalog {
    pub const fn new(tables: &'static [Table]) -> Self {
        Self { tables, map: OnceLock::new() }
    }

    /// `english` in the current language: its Dutch entry, or `english` itself.
    pub fn tr(&self, english: &'static str) -> &'static str {
        if language() == Language::En {
            return english;
        }
        let map = self.map.get_or_init(|| self.entries().collect());
        map.get(english).copied().unwrap_or(english)
    }

    /// Every entry of every table.
    pub fn entries(&self) -> impl Iterator<Item = (&'static str, &'static str)> {
        self.tables.iter().flat_map(|table| table.iter().copied())
    }

    /// What a catalog test reports: source keys without a Dutch entry, entries whose
    /// placeholders differ from their key, keys listed twice and empty translations.
    pub fn problems(&self, source_keys: &BTreeSet<String>) -> Vec<String> {
        let mut problems = Vec::new();
        let mut seen = BTreeSet::new();
        for (english, dutch) in self.entries() {
            if !seen.insert(english) {
                problems.push(format!("listed twice: {english:?}"));
            }
            if dutch.trim().is_empty() {
                problems.push(format!("empty translation: {english:?}"));
            }
            if placeholders(english) != placeholders(dutch) {
                problems.push(format!("placeholders differ: {english:?} → {dutch:?}"));
            }
        }
        for key in source_keys {
            if !seen.contains(key.as_str()) {
                problems.push(format!("no Dutch entry: {key:?}"));
            }
        }
        problems
    }
}

/// Fills the `{name}` placeholders of `template` with `args`. Unknown placeholders stay as they
/// are; `{{` and `}}` are literal braces.
pub fn fill(template: &str, args: &[(&str, &dyn Display)]) -> String {
    let mut out = String::with_capacity(template.len() + 16);
    let mut rest = template;
    while let Some(open) = rest.find(['{', '}']) {
        out.push_str(&rest[..open]);
        let tail = &rest[open..];
        if tail.starts_with("{{") || tail.starts_with("}}") {
            out.push_str(&tail[..1]);
            rest = &tail[2..];
            continue;
        }
        if tail.starts_with('{')
            && let Some(close) = tail.find('}')
            && let Some((_, value)) = args.iter().find(|(key, _)| *key == &tail[1..close])
        {
            out.push_str(&value.to_string());
            rest = &tail[close + 1..];
            continue;
        }
        out.push_str(&tail[..1]);
        rest = &tail[1..];
    }
    out.push_str(rest);
    out
}

/// The placeholder names in `template`, sorted.
pub fn placeholders(template: &str) -> Vec<&str> {
    let mut names = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let tail = &rest[open..];
        if let Some(after) = tail.strip_prefix("{{") {
            rest = after;
            continue;
        }
        match tail.find('}') {
            Some(close) => {
                names.push(&tail[1..close]);
                rest = &tail[close + 1..];
            }
            None => break,
        }
    }
    names.sort_unstable();
    names
}

/// The English keys passed to `tr("…")` and `trf("…", …)` in the `.rs` files under `dir`, for
/// catalog tests. Keys must be plain string literals (no raw strings, no `concat!`).
#[doc(hidden)]
pub fn source_keys(dir: &Path) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(path) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&path) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs")
                // This module's own examples and tests are not interface text.
                && path.file_name().is_none_or(|name| name != "i18n.rs")
                && let Ok(text) = std::fs::read_to_string(&path)
            {
                collect_keys(&text, &mut keys);
            }
        }
    }
    keys
}

fn collect_keys(text: &str, keys: &mut BTreeSet<String>) {
    // Comments (docs that show how to call `tr`) are not interface text.
    let code: String = text
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    for marker in ["tr(", "trf("] {
        let mut rest = code.as_str();
        while let Some(at) = rest.find(marker) {
            let before = rest[..at].chars().next_back();
            rest = &rest[at + marker.len()..];
            // `attr(`, `ptr(`: part of another identifier.
            if before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
                continue;
            }
            if let Some(body) = rest.trim_start().strip_prefix('"')
                && let Some(literal) = read_literal(body)
            {
                keys.insert(literal);
            }
        }
    }
}

/// A Rust string literal's value up to its closing quote (common escapes and line
/// continuations).
fn read_literal(body: &str) -> Option<String> {
    let mut out = String::new();
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(out),
            '\\' => match chars.next()? {
                'n' => out.push('\n'),
                't' => out.push('\t'),
                '0' => out.push('\0'),
                '"' => out.push('"'),
                '\'' => out.push('\''),
                '\\' => out.push('\\'),
                '\n' => {
                    while chars.peek().is_some_and(|c| c.is_whitespace()) {
                        chars.next();
                    }
                }
                other => {
                    out.push('\\');
                    out.push(other);
                }
            },
            other => out.push(other),
        }
    }
    None
}

/// Declares a crate's Dutch catalog and its `tr` / `trf` helpers, from one or more tables:
///
/// ```ignore
/// att_core::catalog!(pub(crate) NL = [session::ENTRIES, controllers::ENTRIES]);
/// // tr("Branch changed"); trf("Azure ticket #{id} was not found.", &[("id", &id)])
/// ```
///
/// `tr` translates a fixed string. `trf` translates a template and fills its placeholders.
#[macro_export]
macro_rules! catalog {
    ($vis:vis $name:ident = [$($table:expr),* $(,)?]) => {
        $vis static $name: $crate::i18n::Catalog = $crate::i18n::Catalog::new(&[$($table),*]);

        /// `english` in the interface language.
        #[allow(dead_code)]
        $vis fn tr(english: &'static str) -> &'static str {
            $name.tr(english)
        }

        /// The template `english` in the interface language, with its `{name}` placeholders
        /// filled.
        #[allow(dead_code)]
        $vis fn trf(english: &'static str, args: &[(&str, &dyn ::std::fmt::Display)]) -> String {
            $crate::i18n::fill($name.tr(english), args)
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST: Catalog = Catalog::new(&[&[("Branch changed", "Branch gewijzigd")]]);

    #[test]
    fn fill_replaces_named_placeholders_and_keeps_the_rest() {
        let id = 42;
        assert_eq!(fill("Ticket #{id} of {who}", &[("id", &id)]), "Ticket #42 of {who}");
        assert_eq!(fill("{{literal}} {id}", &[("id", &id)]), "{literal} 42");
        assert_eq!(fill("“{name}”", &[("name", &"Café")]), "“Café”");
        assert_eq!(placeholders("{b} and {a} {{x}}"), ["a", "b"]);
    }

    #[test]
    fn tags_map_to_languages() {
        assert_eq!(Language::from_tag("nl-BE"), Language::Nl);
        assert_eq!(Language::from_tag("NL"), Language::Nl);
        assert_eq!(Language::from_tag("en_GB"), Language::En);
        assert_eq!(Language::from_tag("fr-BE"), Language::En);
    }

    #[test]
    fn lookups_follow_the_language_and_fall_back_to_english() {
        with_language(Language::Nl, || {
            assert_eq!(TEST.tr("Branch changed"), "Branch gewijzigd");
            assert_eq!(TEST.tr("Not in the catalog"), "Not in the catalog");
        });
        assert_eq!(TEST.tr("Branch changed"), "Branch changed");
    }

    #[test]
    fn source_keys_are_read_from_tr_and_trf_calls() {
        let source = r#"let a = tr("Plain"); let b = trf(
            "Ticket #{id} \"x\"", &[]); attr("no"); x::tr("Path");
            let c = tr("Long \
                line");"#;
        let mut keys = BTreeSet::new();
        collect_keys(source, &mut keys);
        assert_eq!(
            keys.into_iter().collect::<Vec<_>>(),
            ["Long line", "Path", "Plain", "Ticket #{id} \"x\""]
        );
    }

    #[test]
    fn problems_name_missing_keys_and_placeholder_mismatches() {
        static BAD: Catalog = Catalog::new(&[&[("Ticket {id}", "Ticket {nummer}"), ("A", " ")]]);
        let keys: BTreeSet<String> = ["Ticket {id}".to_string(), "Missing".to_string()].into();
        let problems = BAD.problems(&keys);
        assert_eq!(problems.len(), 3, "{problems:?}");
    }
}

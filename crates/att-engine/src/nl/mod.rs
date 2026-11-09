//! The Dutch catalog of `att-engine`: English source text → Dutch. See `att_core::i18n`. Code in
//! this crate translates with `crate::nl::tr("…")` / `crate::nl::trf("…", &[…])`. One table per
//! area: `session` for `src/session/`, `controllers` for `src/controllers/` and the files at the
//! crate root.

mod controllers;
mod session;

att_core::catalog!(pub(crate) NL = [session::ENTRIES, controllers::ENTRIES]);

#[cfg(test)]
mod tests {
    /// Every `tr`/`trf` key in att-engine has a Dutch entry with the same placeholders.
    #[test]
    fn the_dutch_catalog_covers_every_key() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let problems = super::NL.problems(&att_core::i18n::source_keys(&src));
        assert!(problems.is_empty(), "{}", problems.join("\n"));
    }
}

//! `Contents/Helpers/AzureTimetrackerUpdater` in Azure timetracker 2.x bundles.
//!
//! Azure timetracker 1.13–1.14.x refuses an update whose bundle lacks this executable, although it
//! runs the helper of the installed 1.x app, never this one. 2.x installs its own updates, so this
//! program does nothing.

fn main() {
    eprintln!(
        "AzureTimetrackerUpdater is a placeholder. It only exists because Azure timetracker \
         1.13-1.14 updates require this file. Azure timetracker 2.0 and later install updates \
         themselves; nothing was changed."
    );
    std::process::exit(1);
}

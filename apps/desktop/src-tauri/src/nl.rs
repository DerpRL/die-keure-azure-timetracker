//! The Dutch catalog of `att-desktop`: English source text → Dutch. See
//! `att_core::i18n`. Code in this crate translates with `crate::nl::tr("…")` /
//! `crate::nl::trf("…", &[…])`.

att_core::catalog!(pub(crate) NL = [ENTRIES]);

const ENTRIES: &[(&str, &str)] = &[
    // -- Tray menu ------------------------------------------------------------------------------
    ("Open overview", "Overzicht openen"),
    ("Settings…", "Instellingen…"),
    ("Settings", "Instellingen"),
    ("Quit Azure timetracker", "Azure timetracker afsluiten"),
    ("Quit", "Afsluiten"),
    // -- Updates --------------------------------------------------------------------------------
    (
        "Updates are disabled in preview and development builds.",
        "Updates zijn uitgeschakeld in preview- en ontwikkelversies.",
    ),
    ("Checking GitHub for a new version…", "GitHub controleren op een nieuwe versie…"),
    ("You’re up to date.", "Je hebt de nieuwste versie."),
    ("Downloading and verifying the update…", "Update downloaden en controleren…"),
    (
        "Download verified. Install and restart when you’re ready.",
        "Download gecontroleerd. Installeer en herstart wanneer je er klaar voor bent.",
    ),
    (
        "Installing the verified update and restarting…",
        "Gecontroleerde update installeren en herstarten…",
    ),
    (
        "The update server could not be reached. Check your connection and try Check for updates again.",
        "De updateserver is niet bereikbaar. Controleer je verbinding en probeer Controleren op updates opnieuw.",
    ),
    (
        "The update server has no release information yet. Try Check for updates again later.",
        "De updateserver heeft nog geen versie-informatie. Probeer Controleren op updates later opnieuw.",
    ),
    (
        "The update could not be verified with the app’s release key, so it was not installed.",
        "De update kon niet worden geverifieerd met de releasesleutel van de app en is daarom niet geïnstalleerd.",
    ),
    (
        "This release has no update for this computer yet.",
        "Deze release heeft nog geen update voor deze computer.",
    ),
    (
        "There is no update to install. Check for updates first.",
        "Er is geen update om te installeren. Controleer eerst op updates.",
    ),
    (
        "The app is still starting. Try again in a moment.",
        "De app is nog aan het opstarten. Probeer het zo meteen opnieuw.",
    ),
    (
        "Automatic checks are off. Use Check for updates to look for a new version.",
        "Automatische controles staan uit. Gebruik Controleren op updates om een nieuwe versie te zoeken.",
    ),
    (
        "Checks for updates when the app opens and every hour.",
        "Controleert op updates wanneer de app opent en elk uur.",
    ),
    (
        "Checks for updates when the app opens and every {count} hours.",
        "Controleert op updates wanneer de app opent en elke {count} uur.",
    ),
    (
        "Checks for updates when the app opens and every minute.",
        "Controleert op updates wanneer de app opent en elke minuut.",
    ),
    (
        "Checks for updates when the app opens and every {count} minutes.",
        "Controleert op updates wanneer de app opent en elke {count} minuten.",
    ),
    (
        "Checks for updates when the app opens and every {count} seconds.",
        "Controleert op updates wanneer de app opent en elke {count} seconden.",
    ),
    ("Version {version} is available.", "Versie {version} is beschikbaar."),
    // -- Quick-switch shortcut ------------------------------------------------------------------
    (
        "“{text}” is not a valid shortcut. Use modifiers and one key, for example {example}.",
        "“{text}” is geen geldige sneltoets. Gebruik modificatietoetsen en één toets, bijvoorbeeld {example}.",
    ),
    (
        "{shortcut} would capture normal typing. Add Control, Option or Command.",
        "{shortcut} zou gewoon typen onderscheppen. Voeg Control, Option of Command toe.",
    ),
    (
        "{shortcut} would capture normal typing. Add Control, Alt or the Windows key.",
        "{shortcut} zou gewoon typen onderscheppen. Voeg Control, Alt of de Windows-toets toe.",
    ),
    (
        "{shortcut} is unavailable or already used by another app. Use Switch ticket in the menu bar.",
        "{shortcut} is niet beschikbaar of al in gebruik door een andere app. Gebruik Ticket wisselen in de menubalk.",
    ),
    (
        "{shortcut} is unavailable or already used by another app. Use Switch ticket from the tray icon.",
        "{shortcut} is niet beschikbaar of al in gebruik door een andere app. Gebruik Ticket wisselen via het pictogram in het systeemvak.",
    ),
    // -- Shell commands -------------------------------------------------------------------------
    ("The data folder is not known yet.", "De gegevensmap is nog niet bekend."),
    ("The data folder {folder} does not exist.", "De gegevensmap {folder} bestaat niet."),
    (
        "The data folder could not be opened: {error}",
        "De gegevensmap kon niet worden geopend: {error}",
    ),
    (
        "System settings could not be opened: {error}",
        "Systeeminstellingen konden niet worden geopend: {error}",
    ),
    (
        "The app stopped before the change was applied.",
        "De app is gestopt voordat de wijziging werd toegepast.",
    ),
];

#[cfg(test)]
mod tests {
    /// Every `tr`/`trf` key in att-desktop (src-tauri) has a Dutch entry with the same placeholders.
    #[test]
    fn the_dutch_catalog_covers_every_key() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let problems = super::NL.problems(&att_core::i18n::source_keys(&src));
        assert!(problems.is_empty(), "{}", problems.join("\n"));
    }
}

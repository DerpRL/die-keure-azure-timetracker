//! The Dutch catalog of `att-platform`: English source text → Dutch. See
//! `att_core::i18n`. Code in this crate translates with `crate::nl::tr("…")` /
//! `crate::nl::trf("…", &[…])`.

att_core::catalog!(pub(crate) NL = [ENTRIES]);

const ENTRIES: &[(&str, &str)] = &[
    (
        "Access to {capability} was denied. Allow it in system settings.",
        "Toegang tot {capability} is geweigerd. Sta het toe in de systeeminstellingen.",
    ),
    ("An application has no bundle identifier.", "Een app heeft geen bundle-ID."),
    ("Calendar", "Agenda"),
    ("Calendar access could not be requested.", "Toegang tot de agenda kon niet gevraagd worden."),
    ("Calendar could not be opened.", "Agenda kon niet geopend worden."),
    ("Choose a program file (.exe).", "Kies een programmabestand (.exe)."),
    (
        "Credential Manager could not read the saved credential",
        "Credential Manager kon de bewaarde inloggegevens niet lezen",
    ),
    (
        "Credential Manager could not remove this credential",
        "Credential Manager kon deze inloggegevens niet verwijderen",
    ),
    (
        "Credential Manager could not save the credential",
        "Credential Manager kon de inloggegevens niet bewaren",
    ),
    (
        "Keychain could not read the saved credential ({status}).",
        "Keychain kon de bewaarde inloggegevens niet lezen ({status}).",
    ),
    (
        "Keychain could not remove this credential ({status}).",
        "Keychain kon deze inloggegevens niet verwijderen ({status}).",
    ),
    (
        "Keychain could not save the credential ({status}).",
        "Keychain kon de inloggegevens niet bewaren ({status}).",
    ),
    ("Microphone app detection", "Detectie van microfoonapps"),
    (
        "Microphone app detection requires macOS 14.2 or later.",
        "Detectie van microfoonapps vereist macOS 14.2 of later.",
    ),
    ("Microphone detection", "Microfoondetectie"),
    ("Reading application details", "Het lezen van appgegevens"),
    ("Secure credential storage", "Veilige opslag van inloggegevens"),
    (
        "The saved credential could not be read. Save it again in Settings.",
        "De bewaarde inloggegevens konden niet gelezen worden. Bewaar ze opnieuw in Instellingen.",
    ),
    ("The selected program could not be found.", "Het gekozen programma is niet gevonden."),
    ("The selected program could not be read.", "Het gekozen programma kon niet gelezen worden."),
    (
        "This credential is too long to save in Credential Manager.",
        "Deze inloggegevens zijn te lang om te bewaren in Credential Manager.",
    ),
    ("Unidentified audio app", "Onbekende audio-app"),
    ("WebKit (browser or web view)", "WebKit (browser of webweergave)"),
    (
        "Windows microphone status is temporarily unavailable ({code}). Retrying automatically.",
        "De microfoonstatus van Windows is tijdelijk niet beschikbaar ({code}). Wordt automatisch opnieuw geprobeerd.",
    ),
    (
        "Windows session notifications could not start",
        "Windows-sessiemeldingen konden niet starten",
    ),
    (
        "Windows session notifications could not start ({error}).",
        "Windows-sessiemeldingen konden niet starten ({error}).",
    ),
    (
        "Windows session notifications did not start in time.",
        "Windows-sessiemeldingen zijn niet op tijd gestart.",
    ),
    ("error {code}", "fout {code}"),
    (
        "macOS microphone status is temporarily unavailable ({status}). Retrying automatically.",
        "De microfoonstatus van macOS is tijdelijk niet beschikbaar ({status}). Wordt automatisch opnieuw geprobeerd.",
    ),
    (
        "{capability} is not available on this system.",
        "{capability} is niet beschikbaar op dit systeem.",
    ),
    ("{name} could not be read.", "{name} kon niet gelezen worden."),
    ("{name} could not start ({error}).", "{name} kon niet starten ({error})."),
    (
        "{name} is not responding. Retrying automatically.",
        "{name} reageert niet. Wordt automatisch opnieuw geprobeerd.",
    ),
    ("{what} failed unexpectedly.", "{what} is onverwacht mislukt."),
];

#[cfg(test)]
mod tests {
    /// Every `tr`/`trf` key in att-platform has a Dutch entry with the same placeholders.
    #[test]
    fn the_dutch_catalog_covers_every_key() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let problems = super::NL.problems(&att_core::i18n::source_keys(&src));
        assert!(problems.is_empty(), "{}", problems.join("\n"));
    }
}

//! The Dutch catalog of `att-net`: English source text → Dutch. See
//! `att_core::i18n`. Code in this crate translates with `crate::nl::tr("…")` /
//! `crate::nl::trf("…", &[…])`.

att_core::catalog!(pub(crate) NL = [ENTRIES]);

const ENTRIES: &[(&str, &str)] = &[
    (
        "7pace did not confirm continued tracking. Refresh your timer before trying again.",
        "7pace heeft niet bevestigd dat de registratie verdergaat. Vernieuw je timer voor je het opnieuw probeert.",
    ),
    (
        "7pace returned an incomplete pairing code. Request a new PIN.",
        "7pace gaf een onvolledige koppelcode terug. Vraag een nieuwe pincode aan.",
    ),
    (
        "7pace returned an unknown pairing status. Request a new PIN.",
        "7pace gaf een onbekende koppelstatus terug. Vraag een nieuwe pincode aan.",
    ),
    (
        "7pace returned an unreadable pairing response. Request a new PIN.",
        "7pace gaf een onleesbaar koppelantwoord terug. Vraag een nieuwe pincode aan.",
    ),
    (
        "7pace returned incomplete sign-in credentials. Pair again in Settings.",
        "7pace gaf onvolledige aanmeldgegevens terug. Koppel opnieuw in Instellingen.",
    ),
    (
        "Azure could not classify this ticket’s workflow state. Try again shortly.",
        "Azure kon de workflowstatus van dit ticket niet bepalen. Probeer het zo meteen opnieuw.",
    ),
    (
        "Azure returned a different ticket. Refresh the details.",
        "Azure gaf een ander ticket terug. Vernieuw de details.",
    ),
    (
        "Azure returned incomplete ticket status. Try again shortly.",
        "Azure gaf een onvolledige ticketstatus terug. Probeer het zo meteen opnieuw.",
    ),
    ("Azure ticket #{id}", "Azure-ticket #{id}"),
    (
        "Could not connect to {host}. Check your network connection and try again.",
        "Kan geen verbinding maken met {host}. Controleer je netwerkverbinding en probeer het opnieuw.",
    ),
    ("Enter a valid Azure ticket number.", "Vul een geldig Azure-ticketnummer in."),
    (
        "Enter the Azure DevOps organization name only.",
        "Vul alleen de naam van de Azure DevOps-organisatie in.",
    ),
    (
        "Enter the Azure DevOps project name exactly as it appears in Azure.",
        "Vul de naam van het Azure DevOps-project in, precies zoals die in Azure staat.",
    ),
    (
        "Enter the organization name from dev.azure.com/your-organization.",
        "Vul de organisatienaam in uit dev.azure.com/jouw-organisatie.",
    ),
    ("Invalid worklog ID.", "Ongeldige boekings-ID."),
    (
        "Only secure HTTPS connections are allowed.",
        "Alleen beveiligde HTTPS-verbindingen zijn toegestaan.",
    ),
    (
        "Secure connections could not be set up on this computer.",
        "Beveiligde verbindingen konden niet ingesteld worden op deze computer.",
    ),
    (
        "Select a shorter history range to load these worklogs.",
        "Kies een kortere periode in de geschiedenis om deze boekingen te laden.",
    ),
    (
        "The 7pace sign-in could not be renewed. Try again.",
        "De aanmelding bij 7pace kon niet vernieuwd worden. Probeer het opnieuw.",
    ),
    (
        "The connection to {host} was interrupted. Refresh to check the actual timer before trying again.",
        "De verbinding met {host} is onderbroken. Vernieuw om de werkelijke timer te controleren voor je het opnieuw probeert.",
    ),
    (
        "The data couldn’t be read because it isn’t in the correct format.",
        "De gegevens konden niet gelezen worden omdat ze niet de juiste indeling hebben.",
    ),
    (
        "The request could not be prepared. Try again.",
        "Het verzoek kon niet voorbereid worden. Probeer het opnieuw.",
    ),
    (
        "The saved credential contains characters that cannot be sent. Replace it in Settings.",
        "De bewaarde inloggegevens bevatten tekens die niet verstuurd kunnen worden. Vervang ze in Instellingen.",
    ),
    (
        "The server redirected the request. Check the exact workspace URL in Settings.",
        "De server heeft het verzoek omgeleid. Controleer de exacte URL van de werkruimte in Instellingen.",
    ),
    (
        "This entry has an invalid 7pace worklog ID.",
        "Deze boeking heeft een ongeldige 7pace-boekings-ID.",
    ),
    (
        "Use your 7pace workspace URL: https://your-organization.timehub.7pace.com",
        "Gebruik de URL van je 7pace-werkruimte: https://jouw-organisatie.timehub.7pace.com",
    ),
    ("Work item #{id}", "Werkitem #{id}"),
    (
        "{host} returned HTTP {status}. Refresh to check the actual timer before trying again.",
        "{host} gaf HTTP {status} terug. Vernieuw om de werkelijke timer te controleren voor je het opnieuw probeert.",
    ),
];

#[cfg(test)]
mod tests {
    /// Every `tr`/`trf` key in att-net has a Dutch entry with the same placeholders.
    #[test]
    fn the_dutch_catalog_covers_every_key() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let problems = super::NL.problems(&att_core::i18n::source_keys(&src));
        assert!(problems.is_empty(), "{}", problems.join("\n"));
    }
}

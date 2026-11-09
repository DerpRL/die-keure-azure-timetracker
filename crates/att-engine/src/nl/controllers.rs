//! Dutch for `src/controllers/` and the files at the crate root.

pub(super) const ENTRIES: &[(&str, &str)] = &[
    // -- Time editor --------------------------------------------------------------------------
    (
        "7pace does not allow editing this entry.",
        "7pace staat niet toe dat je deze boeking bewerkt.",
    ),
    (
        "An entry changed. Refresh the correction review.",
        "Een boeking is gewijzigd. Vernieuw de controle van de correcties.",
    ),
    ("Choose a correction to preview.", "Kies een correctie om te bekijken."),
    ("Choose a recent edit.", "Kies een recente wijziging."),
    ("Choose an entry.", "Kies een boeking."),
    ("Choose one of the offered corrections.", "Kies een van de voorgestelde correcties."),
    ("Connect to 7pace first.", "Maak eerst verbinding met 7pace."),
    (
        "Edit history could not be read. {error}",
        "De wijzigingsgeschiedenis kon niet worden gelezen. {error}",
    ),
    ("Edit history is unavailable.", "De wijzigingsgeschiedenis is niet beschikbaar."),
    (
        "Enter a valid ticket number or leave it blank.",
        "Voer een geldig ticketnummer in of laat het leeg.",
    ),
    (
        "Enter a valid ticket number, or leave it empty for comment-only time.",
        "Voer een geldig ticketnummer in, of laat het leeg voor tijd met alleen een opmerking.",
    ),
    ("Idle time", "Inactieve tijd"),
    ("Overlap check incomplete. {error}", "Controle op overlap onvolledig. {error}"),
    (
        "Pause or stop the timer that crosses this review window, so its boundaries are confirmed.",
        "Pauzeer of stop de timer die over deze controleperiode loopt, zodat de grenzen ervan bevestigd zijn.",
    ),
    (
        "Review Recent edits in the Time editor before adding time.",
        "Controleer Recente wijzigingen in de Tijdeditor voordat je tijd toevoegt.",
    ),
    ("Select two overlapping entries.", "Selecteer twee overlappende boekingen."),
    (
        "The 7pace connection changed. Nothing was saved.",
        "De verbinding met 7pace is gewijzigd. Er is niets opgeslagen.",
    ),
    (
        "The app closed during this change. Check the affected entries in 7pace; no request will be replayed.",
        "De app werd gesloten tijdens deze wijziging. Controleer de betrokken boekingen in 7pace; er wordt geen verzoek opnieuw verstuurd.",
    ),
    (
        "The idle interval is no longer inside this entry. Check its recorded time.",
        "De inactieve periode valt niet meer binnen deze boeking. Controleer de geregistreerde tijd.",
    ),
    (
        "The stopped session has no 7pace worklog to correct. Check its recorded time in the Time editor.",
        "De gestopte sessie heeft geen boeking in 7pace om te corrigeren. Controleer de geregistreerde tijd in de Tijdeditor.",
    ),
    (
        "There is no elapsed workday to review for this date.",
        "Er is voor deze datum geen verstreken werkdag om te controleren.",
    ),
    ("This change has no entries.", "Deze wijziging heeft geen boekingen."),
    (
        "This change is no longer listed in Recent edits.",
        "Deze wijziging staat niet meer in Recente wijzigingen.",
    ),
    (
        "This correction is no longer listed. Refresh the review.",
        "Deze correctie staat niet meer in de lijst. Vernieuw de controle.",
    ),
    (
        "User acknowledged checking the entries in 7pace.",
        "De gebruiker heeft bevestigd dat de boekingen in 7pace gecontroleerd zijn.",
    ),
    (
        "{title} confirmed by 7pace. You can undo this from Recent edits.",
        "{title} bevestigd door 7pace. Je kunt dit ongedaan maken via Recente wijzigingen.",
    ),
    // App activity entries.
    ("Added an entry in 7pace", "Boeking toegevoegd in 7pace"),
    ("Saved a time correction in 7pace", "Tijdcorrectie opgeslagen in 7pace"),
    ("Tracked time added", "Geregistreerde tijd toegevoegd"),
    ("Tracked time updated", "Geregistreerde tijd bijgewerkt"),
    // -- Offline drafts -----------------------------------------------------------------------
    (
        "An uploaded or unconfirmed draft cannot be edited.",
        "Een geüpload of onbevestigd concept kan niet bewerkt worden.",
    ),
    (
        "Choose a ticket or add a comment for ticket-free work.",
        "Kies een ticket of voeg een opmerking toe voor werk zonder ticket.",
    ),
    (
        "Could not save activities for offline use: {error}",
        "De activiteiten konden niet worden opgeslagen voor offline gebruik: {error}",
    ),
    ("Draft confirmed by 7pace.", "Concept bevestigd door 7pace."),
    ("Draft saved on this Mac.", "Concept opgeslagen op deze Mac."),
    (
        "Draft unlocked after your check. Review again before uploading.",
        "Concept ontgrendeld na je controle. Controleer het opnieuw voordat je het uploadt.",
    ),
    (
        "Linked to the existing 7pace entry. No time was added.",
        "Gekoppeld aan de bestaande boeking in 7pace. Er is geen tijd toegevoegd.",
    ),
    (
        "Local drafts could not be read. The file has been preserved: {error}",
        "Lokale concepten konden niet worden gelezen. Het bestand is bewaard: {error}",
    ),
    (
        "Local timer saved. This does not change the 7pace timer.",
        "Lokale timer opgeslagen. Dit verandert niets aan de timer in 7pace.",
    ),
    (
        "Local timer stopped. Review the draft before uploading.",
        "Lokale timer gestopt. Controleer het concept voordat je het uploadt.",
    ),
    (
        "The local timer cannot start in the future.",
        "De lokale timer kan niet in de toekomst starten.",
    ),
    (
        "The saved drafts are unreadable; the original file has been preserved.",
        "De opgeslagen concepten zijn onleesbaar; het oorspronkelijke bestand is bewaard.",
    ),
    (
        "This draft belongs to another 7pace workspace.",
        "Dit concept hoort bij een andere 7pace-werkruimte.",
    ),
    ("This entry changed. Refresh the review.", "Deze boeking is gewijzigd. Vernieuw de controle."),
    (
        "Upload outcome is unconfirmed. Review this draft and check 7pace before retrying. {error}",
        "Het resultaat van de upload is niet bevestigd. Controleer dit concept en kijk in 7pace na voordat je het opnieuw probeert. {error}",
    ),
    (
        "Wait for the current check with 7pace to finish, then try again.",
        "Wacht tot de huidige controle met 7pace klaar is en probeer het dan opnieuw.",
    ),
    (
        "Wait for the offline draft upload to finish.",
        "Wacht tot de upload van het offline concept klaar is.",
    ),
    // -- Weekly report ------------------------------------------------------------------------
    ("Draft exported.", "Concept geëxporteerd."),
    (
        "Draft generated. Review outcomes and blockers before sharing.",
        "Concept gemaakt. Controleer resultaten en blokkades voordat je het deelt.",
    ),
    (
        "Draft is in memory but could not be saved: {error}",
        "Het concept staat in het geheugen maar kon niet worden opgeslagen: {error}",
    ),
    (
        "Replace this week’s draft? This replaces your local draft with a fresh summary of the loaded time.",
        "Het concept van deze week vervangen? Dit vervangt je lokale concept door een nieuwe samenvatting van de geladen tijd.",
    ),
    (
        "Saved drafts could not be read: {error}",
        "Opgeslagen concepten konden niet worden gelezen: {error}",
    ),
    // -- Statistics and ticket context --------------------------------------------------------
    (
        "Add your Azure organization and PAT in Settings to load ticket details.",
        "Voeg je Azure-organisatie en PAT toe in Instellingen om ticketdetails te laden.",
    ),
    (
        "The downloaded worklogs could not be read.",
        "De gedownloade boekingen konden niet worden gelezen.",
    ),
    // -- Engine, storage and accounts ---------------------------------------------------------
    (
        "7pace pairing changed. Reconnect to use the saved credentials.",
        "De koppeling met 7pace is gewijzigd. Maak opnieuw verbinding om de opgeslagen inloggegevens te gebruiken.",
    ),
    (
        "Another tracking change is still in progress. Wait for it to finish, then try again.",
        "Er loopt nog een andere registratiewijziging. Wacht tot die klaar is en probeer het dan opnieuw.",
    ),
    (
        "Could not save local settings: {error}",
        "Lokale instellingen konden niet worden opgeslagen: {error}",
    ),
    (
        "Keychain could not read the saved credential ({error}).",
        "Keychain kon de opgeslagen inloggegevens niet lezen ({error}).",
    ),
    (
        "Keychain could not save the credential ({error}).",
        "Keychain kon de inloggegevens niet opslaan ({error}).",
    ),
    (
        "Local settings could not be saved because the saved data could not be read.",
        "Lokale instellingen konden niet worden opgeslagen omdat de opgeslagen gegevens niet gelezen konden worden.",
    ),
    (
        "Pair this Mac with a mobile PIN in Settings → Accounts.",
        "Koppel deze Mac met een mobiele pincode in Instellingen → Accounts.",
    ),
    (
        "Pair with a mobile PIN or add your 7pace API token in Settings → Accounts.",
        "Koppel met een mobiele pincode of voeg je 7pace-API-token toe in Instellingen → Accounts.",
    ),
    (
        "Saved settings could not be read. The original data has been preserved: {error}",
        "Opgeslagen instellingen konden niet worden gelezen. De oorspronkelijke gegevens zijn bewaard: {error}",
    ),
    (
        "Settings from Azure timetracker 1.x could not be imported: {error}",
        "Instellingen van Azure timetracker 1.x konden niet worden geïmporteerd: {error}",
    ),
    (
        "The operation stopped unexpectedly. Refresh and try again.",
        "De bewerking is onverwacht gestopt. Vernieuw en probeer het opnieuw.",
    ),
    ("The request has no type.", "Het verzoek heeft geen type."),
    ("The request {kind} is not valid: {error}", "Het verzoek {kind} is ongeldig: {error}"),
    (
        "The saved 7pace pairing could not be read. Pair again in Settings.",
        "De opgeslagen koppeling met 7pace kon niet worden gelezen. Koppel opnieuw in Instellingen.",
    ),
];

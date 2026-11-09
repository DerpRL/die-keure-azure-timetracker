//! The Dutch catalog of `att-core`: English source text → Dutch. See [`crate::i18n`]. Code in
//! this crate translates with `crate::nl::tr("…")` / `crate::nl::trf("…", &[…])`.

crate::catalog!(pub(crate) NL = [ENTRIES]);

const ENTRIES: &[(&str, &str)] = &[
    ("# Weekly status · {start} – {end}", "# Weekstatus · {start} – {end}"),
    ("## Activity breakdown", "## Verdeling per activiteit"),
    ("## Blockers", "## Blokkades"),
    ("## Next week", "## Volgende week"),
    ("## Outcomes", "## Resultaten"),
    ("## Time", "## Tijd"),
    ("## Work patterns", "## Werkpatronen"),
    ("## Worked on", "## Gewerkt aan"),
    (
        "- Based on worklogs, not a measurement of concentration. Switches after breaks longer than 15 minutes are excluded.",
        "- Gebaseerd op boekingen, geen meting van concentratie. Wissels na pauzes van meer dan 15 minuten tellen niet mee.",
    ),
    (
        "- Longest continuous recorded block: {duration}",
        "- Langste aaneengesloten geregistreerde blok: {duration}",
    ),
    ("- No recorded time in this week.", "- Geen geregistreerde tijd deze week."),
    ("- Recorded context switches: {count}", "- Geregistreerde contextwissels: {count}"),
    ("- Tracked: {duration}", "- Geregistreerd: {duration}"),
    ("- Weekly target: {duration}", "- Weekdoel: {duration}"),
    ("- [Add blockers or none]", "- [Vul blokkades in, of “geen”]"),
    ("- [Add outcomes]", "- [Vul resultaten in]"),
    ("- [Add priorities]", "- [Vul prioriteiten in]"),
    (
        "- {count} invalid or overlapping segments excluded from work-pattern calculations.",
        "- {count} ongeldige of overlappende segmenten niet meegeteld in de werkpatronen.",
    ),
    (
        "- {count} invalid worklogs omitted from totals.",
        "- {count} ongeldige boekingen niet meegeteld in de totalen.",
    ),
    ("15 minutes", "15 minuten"),
    ("15–30 min", "15–30 min"),
    ("1–2 hours", "1–2 uur"),
    ("2+ hours", "2+ uur"),
    ("30–60 min", "30–60 min"),
    ("5 minutes", "5 minuten"),
    ("7pace access denied", "Geen toegang tot 7pace"),
    ("7pace connected", "7pace verbonden"),
    (
        "7pace did not confirm removal of the original entry.",
        "7pace heeft het verwijderen van de oorspronkelijke boeking niet bevestigd.",
    ),
    (
        "7pace did not confirm that the current timer stopped. The new timer was not started.",
        "7pace heeft niet bevestigd dat de huidige timer gestopt is. De nieuwe timer is niet gestart.",
    ),
    (
        "7pace did not confirm that tracking stopped.",
        "7pace heeft niet bevestigd dat de registratie gestopt is.",
    ),
    (
        "7pace did not confirm the replacement entry as requested.",
        "7pace heeft de vervangende boeking niet bevestigd zoals gevraagd.",
    ),
    (
        "7pace did not confirm the requested time. Reload the entry before trying again.",
        "7pace heeft de gevraagde tijd niet bevestigd. Laad de boeking opnieuw voor je het opnieuw probeert.",
    ),
    (
        "7pace did not confirm the requested timer. Refresh before trying again.",
        "7pace heeft de gevraagde timer niet bevestigd. Vernieuw voor je het opnieuw probeert.",
    ),
    (
        "7pace did not confirm the rounded time. Check the entry in the Timesheet.",
        "7pace heeft de afgeronde tijd niet bevestigd. Controleer de boeking in de Urenstaat.",
    ),
    (
        "7pace did not confirm the selected activity type. Refresh and check the running timer before trying again.",
        "7pace heeft het gekozen activiteitstype niet bevestigd. Vernieuw en controleer de lopende timer voor je het opnieuw probeert.",
    ),
    (
        "7pace did not confirm the tracking comment. Refresh and check the running timer before trying again.",
        "7pace heeft de opmerking bij de registratie niet bevestigd. Vernieuw en controleer de lopende timer voor je het opnieuw probeert.",
    ),
    (
        "7pace did not confirm the updated entry as requested.",
        "7pace heeft de gewijzigde boeking niet bevestigd zoals gevraagd.",
    ),
    (
        "7pace did not confirm this draft exactly. Check 7pace before retrying.",
        "7pace heeft dit concept niet exact bevestigd. Controleer 7pace voor je het opnieuw probeert.",
    ),
    (
        "7pace did not provide the running timer’s start, so its overlaps could not be checked.",
        "7pace gaf de start van de lopende timer niet door, dus overlappingen konden niet gecontroleerd worden.",
    ),
    (
        "7pace does not allow editing or deleting one of these entries. Check its approval state and permissions.",
        "7pace staat niet toe dat een van deze boekingen gewijzigd of verwijderd wordt. Controleer de goedkeuringsstatus en je rechten.",
    ),
    (
        "7pace does not allow editing this entry. Its week may be locked, or your account may lack permission.",
        "7pace staat niet toe dat deze boeking gewijzigd wordt. De week is misschien vergrendeld, of je account heeft er geen rechten voor.",
    ),
    (
        "7pace does not currently allow starting a timer. Check your tracking settings.",
        "7pace laat momenteel niet toe dat je een timer start. Controleer je registratie-instellingen.",
    ),
    (
        "7pace has a running timer without a worklog ID. Stop it before editing recorded time.",
        "7pace heeft een lopende timer zonder boekings-ID. Stop die voor je geregistreerde tijd wijzigt.",
    ),
    (
        "7pace is limiting requests. Try again after {time}.",
        "7pace beperkt het aantal verzoeken. Probeer het opnieuw na {time}.",
    ),
    (
        "7pace needs your response. Continue tracking or stop this session.",
        "7pace wacht op je antwoord. Blijf registreren of stop deze sessie.",
    ),
    ("7pace offline", "7pace offline"),
    ("7pace rejected this request.", "7pace heeft dit verzoek geweigerd."),
    (
        "7pace returned an unknown tracking state. Refresh before changing your timer.",
        "7pace gaf een onbekende registratiestatus terug. Vernieuw voor je je timer wijzigt.",
    ),
    ("7pace status is out of date", "7pace-status is verouderd"),
    (
        "7pace stopped after an unanswered activity check",
        "7pace is gestopt na een onbeantwoorde activiteitscontrole",
    ),
    (
        "7pace stopped your timer at its time limit",
        "7pace heeft je timer gestopt op de tijdslimiet",
    ),
    ("7pace timer checks", "7pace-timercontroles"),
    (
        "A matching entry already exists. Refresh the review and link it instead of uploading again.",
        "Er bestaat al een overeenkomende boeking. Vernieuw het overzicht en koppel ze in plaats van opnieuw te uploaden.",
    ),
    (
        "A replacement entry changed before the merge finished. Check the change history.",
        "Een vervangende boeking is gewijzigd voor het samenvoegen klaar was. Controleer de wijzigingsgeschiedenis.",
    ),
    (
        "Access denied by {service}. Check your token permissions and 7pace license.",
        "Toegang geweigerd door {service}. Controleer de rechten van je token en je 7pace-licentie.",
    ),
    ("Add time", "Tijd toevoegen"),
    ("All Saints’ Day", "Allerheiligen"),
    (
        "An affected entry changed in 7pace. Refresh before applying this change.",
        "Een betrokken boeking is gewijzigd in 7pace. Vernieuw voor je deze wijziging toepast.",
    ),
    (
        "An entry has unreadable times. Refresh or correct it before reviewing gaps.",
        "Een boeking heeft onleesbare tijden. Vernieuw of corrigeer ze voor je gaten nakijkt.",
    ),
    (
        "An entry scheduled for restoration already exists. Refresh before undoing.",
        "Een boeking die hersteld moet worden, bestaat al. Vernieuw voor je ongedaan maakt.",
    ),
    (
        "An existing entry has an unreadable time, so overlaps could not be fully checked.",
        "Een bestaande boeking heeft een onleesbare tijd, dus overlappingen konden niet volledig gecontroleerd worden.",
    ),
    ("App updates", "App-updates"),
    ("Apr", "apr."),
    ("Armistice Day", "Wapenstilstand"),
    ("Ascension Day", "O.H. Hemelvaart"),
    ("Assumption", "O.L.V. Hemelvaart"),
    ("Aug", "aug."),
    (
        "Authentication failed. Check the token for {service} in Settings; it may have expired or been revoked.",
        "Aanmelden mislukt. Controleer het token voor {service} in Instellingen; het is misschien verlopen of ingetrokken.",
    ),
    ("Azure returned incomplete ticket details.", "Azure gaf onvolledige ticketgegevens terug."),
    ("Azure ticket", "Azure-ticket"),
    ("Azure ticket #{id}", "Azure-ticket #{id}"),
    ("Belgian National Day", "Nationale feestdag"),
    ("Branch changes", "Branchwissels"),
    ("Calendar meetings", "Agendavergaderingen"),
    ("Check activity", "Activiteit controleren"),
    (
        "Choose a boundary inside the overlap between two staggered entries.",
        "Kies een grens binnen de overlap tussen twee verschoven boekingen.",
    ),
    (
        "Choose a folder to scan for Git repositories.",
        "Kies een map om naar Git-repository's te doorzoeken.",
    ),
    (
        "Choose a neighboring entry to fill this gap.",
        "Kies een aangrenzende boeking om dit gat te vullen.",
    ),
    (
        "Choose a split time strictly inside the entry.",
        "Kies een splitstijdstip binnen de boeking.",
    ),
    (
        "Choose a valid file and Azure ticket number.",
        "Kies een geldig bestand en Azure-ticketnummer.",
    ),
    (
        "Choose a valid ticket or add a comment for ticket-free time.",
        "Kies een geldig ticket of voeg een opmerking toe voor tijd zonder ticket.",
    ),
    (
        "Choose a valid ticket or supply a tracking comment.",
        "Kies een geldig ticket of geef een opmerking voor de registratie.",
    ),
    (
        "Choose an activity type before starting the timer.",
        "Kies een activiteitstype voor je de timer start.",
    ),
    (
        "Choose an end after the start, with no time in the future.",
        "Kies een einde na de start, zonder tijd in de toekomst.",
    ),
    (
        "Choose idle and forgotten-timer thresholds between 1 and 120 minutes.",
        "Kies drempels voor inactiviteit en een vergeten timer tussen 1 en 120 minuten.",
    ),
    (
        "Choose polling intervals within the ranges shown in Settings.",
        "Kies verversingsintervallen binnen de bereiken die Instellingen toont.",
    ),
    ("Choose quiet hours between 00:00 and 23:59.", "Kies stille uren tussen 00:00 en 23:59."),
    (
        "Choose valid times with no time in the future.",
        "Kies geldige tijden zonder tijd in de toekomst.",
    ),
    ("Christmas Day", "Kerstmis"),
    ("Completed tickets", "Afgewerkte tickets"),
    ("Confirmed by 7pace", "Bevestigd door 7pace"),
    ("Connecting", "Verbinden"),
    ("Connecting to 7pace…", "Verbinden met 7pace…"),
    (
        "Continue with a new session, or keep this task stopped. Time since the stop will not be added automatically.",
        "Ga verder met een nieuwe sessie, of laat deze taak gestopt. Tijd sinds de stop wordt niet automatisch toegevoegd.",
    ),
    ("Correct overlapping boundary", "Overlappende grens corrigeren"),
    (
        "Creating a replacement entry; if interrupted, check 7pace before doing anything else.",
        "Vervangende boeking wordt gemaakt; als dit onderbroken wordt, controleer dan eerst 7pace voor je iets anders doet.",
    ),
    ("Current activity", "Huidige activiteit"),
    ("Custom target", "Aangepast doel"),
    ("Daily", "Per dag"),
    ("Dark", "Donker"),
    ("Day", "Dag"),
    ("Day review", "Dagcontrole"),
    (
        "Day review needs a finish time after the workday start, at least one selected day, and valid gap/long-entry thresholds.",
        "De dagcontrole heeft een eindtijd na de start van de werkdag nodig, minstens één gekozen dag en geldige drempels voor gaten en lange boekingen.",
    ),
    ("Dec", "dec."),
    ("Detached HEAD", "Detached HEAD"),
    ("Disconnected", "Niet verbonden"),
    (
        "Draft based on recorded time; add outcomes before sharing.",
        "Concept op basis van geregistreerde tijd; voeg resultaten toe voor je het deelt.",
    ),
    (
        "Each daily target must be between 0 and 24 hours. Use 0 for a day off.",
        "Elk dagdoel moet tussen 0 en 24 uur liggen. Gebruik 0 voor een vrije dag.",
    ),
    ("Easter Monday", "Paasmaandag"),
    ("Edit time", "Tijd bewerken"),
    (
        "Enter a valid default meeting ticket number, or leave it empty.",
        "Vul een geldig standaardticketnummer voor vergaderingen in, of laat het leeg.",
    ),
    ("Feb", "feb."),
    ("Figma files", "Figma-bestanden"),
    ("Fill gap with neighboring task", "Gat vullen met aangrenzende taak"),
    ("Fri", "vr"),
    ("Full-day leave", "Verlof volledige dag"),
    ("Git HEAD is temporarily unreadable.", "Git HEAD is tijdelijk onleesbaar."),
    ("Google Meet / web browsers", "Google Meet / webbrowsers"),
    ("Half-day leave", "Verlof halve dag"),
    ("Hourly", "Per uur"),
    ("Increased", "Verhoogd"),
    ("Invalid .git file in {name}.", "Ongeldig .git-bestand in {name}."),
    ("Invalid pattern: {error}", "Ongeldig patroon: {error}"),
    ("Jan", "jan."),
    ("Jul", "jul."),
    ("Jun", "jun."),
    ("Labour Day", "Dag van de Arbeid"),
    ("Last known: {detail}", "Laatst bekend: {detail}"),
    ("Light", "Licht"),
    ("Mar", "mrt."),
    ("May", "mei"),
    ("Meeting", "Vergadering"),
    ("Meeting ended", "Vergadering afgelopen"),
    (
        "Merge entries with the same ticket, activity, comment and owner. Different work stays separate.",
        "Voeg boekingen samen met hetzelfde ticket, dezelfde activiteit, opmerking en eigenaar. Ander werk blijft apart.",
    ),
    ("Merge {count} entries", "{count} boekingen samenvoegen"),
    ("Microphone meetings", "Microfoonvergaderingen"),
    ("Mon", "ma"),
    ("Month", "Maand"),
    ("Monthly", "Per maand"),
    ("New Year’s Day", "Nieuwjaar"),
    (
        "No Git repository at {name}. Choose its root folder.",
        "Geen Git-repository in {name}. Kies de hoofdmap ervan.",
    ),
    ("No keyboard or mouse activity", "Geen toetsenbord- of muisactiviteit"),
    ("No unique ticket found", "Geen uniek ticket gevonden"),
    ("Nov", "nov."),
    ("Oct", "okt."),
    (
        "Only a confirmed, completed change can be undone.",
        "Alleen een bevestigde, voltooide wijziging kan ongedaan gemaakt worden.",
    ),
    (
        "Only adjacent entries can be merged. Gaps and overlapping time are not filled or removed.",
        "Alleen aangrenzende boekingen kunnen samengevoegd worden. Gaten en overlappende tijd worden niet gevuld of verwijderd.",
    ),
    ("Other activity", "Andere activiteit"),
    ("Other apps", "Andere apps"),
    (
        "Overlap details changed. Refresh the review before uploading.",
        "De overlapgegevens zijn gewijzigd. Vernieuw het overzicht voor je uploadt.",
    ),
    ("Paused", "Gepauzeerd"),
    ("Paused ticket", "Gepauzeerd ticket"),
    ("Paused tracking", "Gepauzeerde registratie"),
    ("Preparing change", "Wijziging voorbereiden"),
    ("Related link", "Gerelateerde link"),
    ("Remove interval from entry", "Interval uit boeking verwijderen"),
    ("Removing original entry {id}.", "Oorspronkelijke boeking {id} wordt verwijderd."),
    ("Replacement holiday", "Vervangende feestdag"),
    ("Return after meetings", "Terugkeren na vergaderingen"),
    ("Sat", "za"),
    (
        "Select at least two different entries to merge.",
        "Selecteer minstens twee verschillende boekingen om samen te voegen.",
    ),
    ("Select two overlapping entries.", "Selecteer twee overlappende boekingen."),
    ("Sep", "sep."),
    ("Separate idle interval", "Inactief interval afsplitsen"),
    (
        "Set a 7pace workspace URL in Settings first.",
        "Stel eerst een URL voor je 7pace-werkruimte in bij Instellingen.",
    ),
    ("Set up 7pace", "7pace instellen"),
    ("Sign in to 7pace", "Aanmelden bij 7pace"),
    ("Split entry", "Boeking splitsen"),
    ("Stand-up", "Stand-up"),
    ("Standard", "Standaard"),
    ("Still working on this task?", "Nog bezig met deze taak?"),
    ("Stop the existing local timer first.", "Stop eerst de bestaande lokale timer."),
    (
        "Stop the local timer before reviewing this draft.",
        "Stop de lokale timer voor je dit concept nakijkt.",
    ),
    ("Stopped", "Gestopt"),
    ("Sun", "zo"),
    ("System", "Systeem"),
    (
        "The branch pattern is too complex to check this branch. Simplify the pattern.",
        "Het branchpatroon is te complex om deze branch te controleren. Vereenvoudig het patroon.",
    ),
    (
        "The branch pattern needs a capture group for the ticket number, such as ([0-9]+).",
        "Het branchpatroon heeft een capturegroep voor het ticketnummer nodig, zoals ([0-9]+).",
    ),
    (
        "The file couldn’t be opened because it isn’t in the correct format.",
        "Het bestand kon niet geopend worden omdat het niet de juiste indeling heeft.",
    ),
    (
        "The file “{name}” couldn’t be opened because there is no such file.",
        "Het bestand “{name}” kon niet geopend worden omdat het niet bestaat.",
    ),
    (
        "The file “{name}” couldn’t be opened because you don’t have permission to view it.",
        "Het bestand “{name}” kon niet geopend worden omdat je geen toestemming hebt om het te bekijken.",
    ),
    ("The file “{name}” couldn’t be opened.", "Het bestand “{name}” kon niet geopend worden."),
    ("The operation was cancelled.", "De bewerking is geannuleerd."),
    (
        "The overlap check could not be completed. {error}",
        "De overlapcontrole kon niet voltooid worden. {error}",
    ),
    (
        "The request timed out. Refresh to see what 7pace recorded before trying again.",
        "Het verzoek duurde te lang. Vernieuw om te zien wat 7pace geregistreerd heeft voor je het opnieuw probeert.",
    ),
    (
        "The requested entry or API endpoint was not found.",
        "De gevraagde boeking of API-endpoint is niet gevonden.",
    ),
    (
        "The saved activity is no longer available. Edit the draft’s activity.",
        "De bewaarde activiteit is niet meer beschikbaar. Wijzig de activiteit van het concept.",
    ),
    (
        "The selected interval is outside this entry. Refresh the recorded time.",
        "Het gekozen interval ligt buiten deze boeking. Vernieuw de geregistreerde tijd.",
    ),
    ("The value “{pattern}” is invalid.", "De waarde “{pattern}” is ongeldig."),
    (
        "This Figma suggestion is outdated or its ticket link changed. Review the latest suggestion.",
        "Deze Figma-suggestie is verouderd of de ticketkoppeling is gewijzigd. Bekijk de nieuwste suggestie.",
    ),
    (
        "This change contains duplicate or unknown entries.",
        "Deze wijziging bevat dubbele of onbekende boekingen.",
    ),
    ("This change has no entries.", "Deze wijziging heeft geen boekingen."),
    (
        "This draft belongs to another workspace or has an unconfirmed upload. Review it before sending.",
        "Dit concept hoort bij een andere werkruimte of heeft een onbevestigde upload. Kijk het na voor je het verstuurt.",
    ),
    (
        "This entry changed in 7pace. Reload it before editing so another change is not overwritten.",
        "Deze boeking is gewijzigd in 7pace. Laad ze opnieuw voor je ze bewerkt, zodat je geen andere wijziging overschrijft.",
    ),
    (
        "This entry has an invalid time or billable duration.",
        "Deze boeking heeft een ongeldige tijd of factureerbare duur.",
    ),
    (
        "This entry is still running. Stop or pause it before editing.",
        "Deze boeking loopt nog. Stop of pauzeer ze voor je ze bewerkt.",
    ),
    (
        "This start time is ambiguous during a clock change. Choose an unambiguous local time.",
        "Deze starttijd is dubbelzinnig door een klokwissel. Kies een eenduidige lokale tijd.",
    ),
    (
        "This would remove the entire entry. Use a narrower interval, or separate the time into its own entry.",
        "Zo zou de hele boeking verwijderd worden. Gebruik een kleiner interval, of splits de tijd af in een eigen boeking.",
    ),
    ("Thu", "do"),
    ("Ticket #{id}", "Ticket #{id}"),
    ("Time away", "Afwezigheid"),
    ("Tracked time", "Geregistreerde tijd"),
    ("Tracking", "Registratie loopt"),
    ("Tue", "di"),
    ("Unassigned time", "Niet-toegewezen tijd"),
    ("Under 15 min", "Onder 15 min"),
    ("Undo {title}", "{title} ongedaan maken"),
    ("Unnamed activity", "Naamloze activiteit"),
    ("Unspecified activity", "Onbepaalde activiteit"),
    ("Untitled draft", "Naamloos concept"),
    ("Updating entry {id}.", "Boeking {id} wordt bijgewerkt."),
    ("WebKit (browser or web view)", "WebKit (browser of webweergave)"),
    ("WebView2 (browser or web view)", "WebView2 (browser of webweergave)"),
    ("Wed", "wo"),
    ("Week", "Week"),
    ("Whit Monday", "Pinkstermaandag"),
    ("Work item #{id}", "Werkitem #{id}"),
    ("Work session", "Werksessie"),
    ("Work without an Azure ticket", "Werk zonder Azure-ticket"),
    ("Working without a timer", "Werken zonder timer"),
    ("Year", "Jaar"),
    (
        "Your timer changed in 7pace or another app. The current state has been refreshed; review it and try again.",
        "Je timer is gewijzigd in 7pace of in een andere app. De huidige status is vernieuwd; kijk hem na en probeer het opnieuw.",
    ),
    (
        "{detail} Review Recent edits and the actual entries in 7pace before continuing.",
        "{detail} Bekijk Recente wijzigingen en de werkelijke boekingen in 7pace voor je verdergaat.",
    ),
    (
        "{detail} Some changes may already be saved. No request was retried. {error}",
        "{detail} Sommige wijzigingen zijn misschien al bewaard. Er is geen verzoek opnieuw verstuurd. {error}",
    ),
    ("{hours}h {minutes}m", "{hours}u {minutes}m"),
    ("{month} {day}, {year}", "{day} {month} {year}"),
];

#[cfg(test)]
mod tests {
    /// Every `tr`/`trf` key in att-core has a Dutch entry with the same placeholders.
    #[test]
    fn the_dutch_catalog_covers_every_key() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let problems = super::NL.problems(&crate::i18n::source_keys(&src));
        assert!(problems.is_empty(), "{}", problems.join("\n"));
    }
}

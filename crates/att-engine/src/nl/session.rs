//! Dutch for `src/session/`.

pub(super) const ENTRIES: &[(&str, &str)] = &[
    ("7pace default", "7pace-standaard"),
    ("Accessibility permission needed", "Toestemming voor Toegankelijkheid nodig"),
    ("Agenda", "Agenda"),
    (
        "Allow Accessibility for Figma detection, or turn Figma detection off to continue.",
        "Geef toestemming voor Toegankelijkheid voor Figma-detectie, of zet Figma-detectie uit om verder te gaan.",
    ),
    (
        "Azure DevOps could not be reached. Check your internet connection and try again.",
        "Azure DevOps is niet bereikbaar. Controleer je internetverbinding en probeer het opnieuw.",
    ),
    (
        "Azure DevOps did not accept this token for “{organization}”. Check that you copied all of it, that it has not expired, and that it was created for this organization with the Work Items (Read) scope.",
        "Azure DevOps heeft dit token voor “{organization}” niet aanvaard. Controleer of je het volledig hebt gekopieerd, of het niet verlopen is en of het voor deze organisatie is aangemaakt met de scope Work Items (Read).",
    ),
    (
        "Azure DevOps has no organization called “{organization}”. Use the name from dev.azure.com/your-organization.",
        "Azure DevOps heeft geen organisatie met de naam “{organization}”. Gebruik de naam uit dev.azure.com/jouw-organisatie.",
    ),
    (
        "Azure status: {status}. Your timer is still running.",
        "Azure-status: {status}. Je timer loopt nog.",
    ),
    ("Azure ticket", "Azure-ticket"),
    (
        "Azure ticket #{id} was not found or is not accessible.",
        "Azure-ticket #{id} is niet gevonden of niet toegankelijk.",
    ),
    (
        "Azure timetracker — Local tracking · {title} · Not uploaded to 7pace",
        "Azure timetracker — Lokale registratie · {title} · Niet geüpload naar 7pace",
    ),
    ("Branch changed", "Branch gewijzigd"),
    (
        "Calendar access is off. Enable Azure timetracker in System Settings → Privacy & Security → Calendars.",
        "Agendatoegang staat uit. Schakel Azure timetracker in via Systeeminstellingen → Privacy en beveiliging → Agenda’s.",
    ),
    (
        "Calendar is not responding. Retrying automatically.",
        "De agenda reageert niet. We proberen het automatisch opnieuw.",
    ),
    (
        "Check your tracked time and current timer before finishing.",
        "Controleer je geregistreerde tijd en je huidige timer voor je afsluit.",
    ),
    (
        "Choose a history end date on or after the start date.",
        "Kies een einddatum voor de geschiedenis op of na de begindatum.",
    ),
    (
        "Choose a ticket to start tracking, snooze, or ignore today.",
        "Kies een ticket om de registratie te starten, stel uit of negeer vandaag.",
    ),
    ("Choose an Azure ticket in the app.", "Kies een Azure-ticket in de app."),
    ("Choose Design to start tracking from Figma.", "Kies Design om vanuit Figma te registreren."),
    ("Choose quiet hours between 00:00 and 23:59.", "Kies stille uren tussen 00:00 en 23:59."),
    (
        "Choose the Standup activity before starting daily standup tracking.",
        "Kies de activiteit Standup voor je de daily stand-up begint te registreren.",
    ),
    ("Computer asleep or session inactive", "Computer in sluimerstand of sessie inactief"),
    (
        "Connect and refresh 7pace before starting a timer.",
        "Verbind en vernieuw 7pace voor je een timer start.",
    ),
    ("Connect your account in Settings first.", "Verbind eerst je account in Instellingen."),
    ("Could not load activity types: {error}", "Kan de activiteitstypes niet laden: {error}"),
    ("Could not pair with 7pace. {error}", "Koppelen met 7pace is mislukt. {error}"),
    ("Daily standup", "Daily stand-up"),
    ("Day review", "Dagcontrole"),
    (
        "Day review status, Figma history and {removed} synced offline drafts cleared",
        "Dagcontrolestatus, Figma-geschiedenis en {removed} gesynchroniseerde offline concepten gewist",
    ),
    ("Default meeting ticket #{id}", "Standaardticket voor vergaderingen #{id}"),
    ("Detached HEAD", "Detached HEAD"),
    (
        "Develop and long-feature branches suggest a pause or stop.",
        "Develop- en long-feature-branches stellen een pauze of stop voor.",
    ),
    ("Disabled", "Uitgeschakeld"),
    ("Enter a valid Azure ticket number.", "Voer een geldig Azure-ticketnummer in."),
    ("Enter a valid ticket number.", "Voer een geldig ticketnummer in."),
    (
        "Enter this PIN in 7pace → Apps → Pair Mobile App. Waiting for approval…",
        "Voer deze pincode in via 7pace → Apps → Pair Mobile App. Wachten op goedkeuring…",
    ),
    ("Enter your Azure DevOps organization first.", "Voer eerst je Azure DevOps-organisatie in."),
    ("Figma", "Figma"),
    (
        "Figma context could not be saved on this Mac. Resolve the storage error before quitting.",
        "De Figma-context kon niet op deze Mac worden opgeslagen. Los de opslagfout op voor je stopt.",
    ),
    ("Figma file active", "Figma-bestand actief"),
    ("Figma is active · no file address found", "Figma is actief · geen bestandsadres gevonden"),
    (
        "Figma observation was paused, disabled or its workspace changed. Review the current context.",
        "Figma-observatie is gepauzeerd of uitgeschakeld, of de werkruimte is gewijzigd. Controleer de huidige context.",
    ),
    ("File: {name}", "Bestand: {name}"),
    ("Git HEAD is temporarily unreadable.", "Git HEAD is tijdelijk onleesbaar."),
    ("History", "Geschiedenis"),
    ("History: {error}", "Geschiedenis: {error}"),
    (
        "Install Figma Desktop to open this file in Figma.",
        "Installeer Figma Desktop om dit bestand in Figma te openen.",
    ),
    (
        "Keep the recorded time, or pause and review the detected idle interval.",
        "Behoud de geregistreerde tijd, of pauzeer en controleer de gedetecteerde inactieve periode.",
    ),
    ("Kept current tracking", "Huidige registratie behouden"),
    (
        "Keychain could not remove the 7pace credential ({error}).",
        "Keychain kon de 7pace-aanmeldgegevens niet verwijderen ({error}).",
    ),
    ("Linked ticket #{id}", "Gekoppeld ticket #{id}"),
    (
        "Load the activity types before starting your timer.",
        "Laad de activiteitstypes voor je je timer start.",
    ),
    ("Local data reset", "Lokale gegevens opnieuw ingesteld"),
    (
        "Local data was reset. Settings, accounts and unsent offline drafts were kept.",
        "De lokale gegevens zijn opnieuw ingesteld. Instellingen, accounts en niet-verzonden offline concepten zijn behouden.",
    ),
    (
        "Local settings could not be saved. Resolve the storage error before updating.",
        "De lokale instellingen konden niet worden opgeslagen. Los de opslagfout op voor je bijwerkt.",
    ),
    (
        "Local tracking continues on this Mac. Reconnect to confirm the 7pace timer.",
        "De lokale registratie loopt verder op deze Mac. Maak opnieuw verbinding om de 7pace-timer te bevestigen.",
    ),
    ("Mac asleep or session inactive", "Mac in sluimerstand of sessie inactief"),
    ("Meeting", "Vergadering"),
    ("Meeting ended", "Vergadering beëindigd"),
    ("Meeting started", "Vergadering gestart"),
    ("Microphone in use · possible meeting", "Microfoon in gebruik · mogelijk een vergadering"),
    ("Microphone in use: {apps}", "Microfoon in gebruik: {apps}"),
    ("Microphone meeting suggestions are off", "Vergadersuggesties via de microfoon staan uit"),
    (
        "Microphone status did not respond in time. Retrying automatically.",
        "De microfoonstatus reageerde niet op tijd. We proberen het automatisch opnieuw.",
    ),
    (
        "Microphone use is no longer confirmed. Check meeting detection in Settings or choose tracking manually.",
        "Het microfoongebruik is niet meer bevestigd. Controleer de vergaderdetectie in Instellingen of kies de registratie zelf.",
    ),
    ("Microphone use stopped", "Microfoongebruik gestopt"),
    ("New branch. Keep your timer?", "Nieuwe branch. Je timer behouden?"),
    (
        "No ticket needed. The meeting title becomes the comment.",
        "Geen ticket nodig. De titel van de vergadering wordt de opmerking.",
    ),
    ("No ticket tracking suggested", "Geen ticketregistratie voorgesteld"),
    ("No time is logged until you resume", "Er wordt geen tijd geboekt tot je hervat"),
    ("No timer running", "Geen timer actief"),
    ("Offline drafts", "Offline concepten"),
    ("Overview", "Overzicht"),
    (
        "Paired with {host}. Save changes to use this connection.",
        "Gekoppeld met {host}. Sla de wijzigingen op om deze verbinding te gebruiken.",
    ),
    ("Paste your personal access token first.", "Plak eerst je personal access token."),
    ("Pause or stop your timer?", "Je timer pauzeren of stoppen?"),
    ("Paused", "Gepauzeerd"),
    ("Preview mode: testing tokens is turned off.", "Voorbeeldmodus: tokens testen staat uit."),
    ("Ready to start tracking?", "Klaar om te registreren?"),
    ("Repositories", "Repositories"),
    ("Requesting a PIN…", "Pincode aanvragen…"),
    ("Return to #{id}?", "Terug naar #{id}?"),
    ("Review time away", "Afwezigheid controleren"),
    ("Rounding needs attention", "Afronding vraagt aandacht"),
    (
        "Saved data could not be read. The original data has been preserved: {error}",
        "Opgeslagen gegevens konden niet worden gelezen. De oorspronkelijke gegevens zijn bewaard: {error}",
    ),
    (
        "Saved the stopped entry to the nearest quarter hour",
        "De gestopte boeking is afgerond op het dichtstbijzijnde kwartier",
    ),
    ("Screen locked", "Scherm vergrendeld"),
    ("Settings", "Instellingen"),
    (
        "Showing the last known timer. Check 7pace before changing it.",
        "De laatst bekende timer wordt getoond. Controleer 7pace voor je hem wijzigt.",
    ),
    ("Some details could not refresh", "Sommige gegevens konden niet worden vernieuwd"),
    ("Statistics", "Statistieken"),
    ("Stopped the active 7pace timer", "De actieve 7pace-timer is gestopt"),
    (
        "Switch to Azure ticket #{id}, or keep your current tracking.",
        "Schakel over naar Azure-ticket #{id}, of behoud je huidige registratie.",
    ),
    (
        "The application could not be read in time.",
        "De applicatie kon niet op tijd worden gelezen.",
    ),
    (
        "The Design activity is missing in 7pace. Add or enable Design before starting from Figma.",
        "De activiteit Design ontbreekt in 7pace. Voeg Design toe of schakel het in voor je vanuit Figma start.",
    ),
    (
        "The file “{name}” could not be saved: {error}",
        "Het bestand “{name}” kon niet worden opgeslagen: {error}",
    ),
    (
        "The idle review could not be saved locally. Your timer has not been stopped.",
        "De controle van de inactieve tijd kon niet lokaal worden opgeslagen. Je timer is niet gestopt.",
    ),
    (
        "The meeting timer changed. Review your current tracking before returning.",
        "De vergadertimer is gewijzigd. Controleer je huidige registratie voor je terugkeert.",
    ),
    (
        "The onboarding could not be reopened: {error}",
        "De introductie kon niet opnieuw worden geopend: {error}",
    ),
    (
        "The PIN expired. Request a new PIN and enter it within one minute.",
        "De pincode is verlopen. Vraag een nieuwe pincode aan en voer die binnen een minuut in.",
    ),
    (
        "The Standup activity is missing in 7pace. Add or enable it before tracking this stand-up.",
        "De activiteit Standup ontbreekt in 7pace. Voeg ze toe of schakel ze in voor je deze stand-up registreert.",
    ),
    (
        "The Standup activity is required to track daily standup.",
        "De activiteit Standup is nodig om de daily stand-up te registreren.",
    ),
    (
        "The stopped entry was saved as tracked, not rounded to a quarter hour. {error}",
        "De gestopte boeking is opgeslagen zoals geregistreerd, niet afgerond op een kwartier. {error}",
    ),
    (
        "The stopped task has no ticket or comment. Choose a task manually.",
        "De gestopte taak heeft geen ticket of opmerking. Kies zelf een taak.",
    ),
    ("This branch suggestion is no longer active.", "Deze branchsuggestie is niet meer actief."),
    (
        "This branch suggests pausing or stopping your current timer.",
        "Deze branch stelt voor om je huidige timer te pauzeren of te stoppen.",
    ),
    ("This Figma file key is invalid.", "Deze Figma-bestandssleutel is ongeldig."),
    (
        "This Figma file’s ticket link changed. Choose the ticket again.",
        "De ticketkoppeling van dit Figma-bestand is gewijzigd. Kies het ticket opnieuw.",
    ),
    (
        "This meeting return is no longer available.",
        "Deze terugkeer na de vergadering is niet meer beschikbaar.",
    ),
    (
        "This meeting suggestion has ended or is no longer available.",
        "Deze vergadersuggestie is afgelopen of niet meer beschikbaar.",
    ),
    (
        "This microphone reminder is no longer current. Check the active timer before changing it.",
        "Deze microfoonherinnering is niet meer actueel. Controleer de actieve timer voor je hem wijzigt.",
    ),
    (
        "This paused session is no longer available.",
        "Deze gepauzeerde sessie is niet meer beschikbaar.",
    ),
    (
        "This repository changed branches again. Review the latest suggestion.",
        "Deze repository is opnieuw van branch gewisseld. Bekijk de nieuwste suggestie.",
    ),
    (
        "This ticket is no longer completed. Your timer is unchanged.",
        "Dit ticket is niet meer afgerond. Je timer is niet gewijzigd.",
    ),
    (
        "This ticket is not in the isolated preview.",
        "Dit ticket zit niet in de afgeschermde voorbeeldweergave.",
    ),
    (
        "This token cannot read work items in “{organization}”. Edit it in Azure DevOps and add the Work Items (Read) scope.",
        "Dit token kan geen work items lezen in “{organization}”. Bewerk het in Azure DevOps en voeg de scope Work Items (Read) toe.",
    ),
    ("Time editor", "Tijdeditor"),
    ("Time rounded", "Tijd afgerond"),
    ("Time to review your day", "Tijd om je dag te controleren"),
    (
        "Track a meeting, or a daily standup with the Standup activity.",
        "Registreer een vergadering, of een daily stand-up met de activiteit Standup.",
    ),
    (
        "Track Design with the file name as the comment. No ticket needed.",
        "Registreer Design met de bestandsnaam als opmerking. Geen ticket nodig.",
    ),
    ("Tracked ticket completed", "Geregistreerd ticket afgerond"),
    ("Tracking", "Registratie"),
    ("Tracking needs attention", "Registratie vraagt aandacht"),
    ("Tracking paused", "Registratie gepauzeerd"),
    ("Tracking started", "Registratie gestart"),
    ("Tracking stopped", "Registratie gestopt"),
    ("Unpaired from 7pace", "Ontkoppeld van 7pace"),
    ("Untitled event", "Naamloze afspraak"),
    ("Untitled meeting", "Naamloze vergadering"),
    (
        "Wait for the current save or connection operation to finish before restarting.",
        "Wacht tot het huidige opslaan of verbinden klaar is voor je herstart.",
    ),
    ("Waiting for Figma", "Wachten op Figma"),
    (
        "Watching microphone status · checked every 2 seconds",
        "Microfoonstatus wordt gevolgd · elke 2 seconden gecontroleerd",
    ),
    ("Weekly report", "Weekrapport"),
    ("Working without a timer?", "Aan het werk zonder timer?"),
    (
        "Workspace changed. Review the link again.",
        "Werkruimte gewijzigd. Controleer de koppeling opnieuw.",
    ),
    ("your work app", "je werkapp"),
    (
        "{apps} has not used the microphone for at least a minute. Has your meeting finished?",
        "{apps} gebruikt de microfoon al minstens een minuut niet meer. Is je vergadering afgelopen?",
    ),
    (
        "{error} Check the timer before continuing; no correction was applied.",
        "{error} Controleer de timer voor je verdergaat; er is geen correctie toegepast.",
    ),
    ("{repository}: tracking unchanged", "{repository}: registratie ongewijzigd"),
    (
        "“{organization}” has no project called “{project}”, or this token cannot see it. Check the spelling, or leave Project empty to search every project.",
        "“{organization}” heeft geen project met de naam “{project}”, of dit token kan het niet zien. Controleer de spelling, of laat Project leeg om in alle projecten te zoeken.",
    ),
];

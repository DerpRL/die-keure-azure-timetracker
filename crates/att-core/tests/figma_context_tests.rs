//! Ported from FigmaContextTests.swift. `outdatedContextNeverMutatesTracking` and
//! `ticketFreeDesignStartsWithFileComment` exercise `TrackingTransaction` and move with the
//! tracking port.

#[path = "support/context.rs"]
mod support;

use att_core::figma::{
    FigmaActivation, FigmaContextEvent, FigmaDocument, FigmaLedger, FigmaObservation,
    FigmaPreferences, FigmaStore, FigmaSuggestion, design_activity,
};
use att_core::model::HostOs;
use att_core::time::add_secs;
use jiff::Timestamp;
use support::{activity, at, swift};
use uuid::Uuid;

fn now() -> Timestamp {
    at(1_780_000_000.0)
}

fn after(seconds: f64) -> Timestamp {
    add_secs(now(), seconds)
}

fn a() -> FigmaDocument {
    FigmaDocument::new("Alpha12", "First design")
}

fn b() -> FigmaDocument {
    FigmaDocument::new("Beta34", "Board")
}

fn prefs() -> FigmaPreferences {
    FigmaPreferences::default()
}

fn event(file: &str, timestamp: Timestamp) -> FigmaContextEvent {
    FigmaContextEvent {
        id: Uuid::new_v4(),
        timestamp,
        kind: "figma".to_string(),
        file: file.to_string(),
        name: file.to_string(),
        ticket_id: None,
    }
}

#[test]
fn exact_host_and_file_urls_only() {
    let parsed = FigmaDocument::parse(
        "https://www.figma.com/design/n9ThKF7vJaGkvauPbXYLoR/UX-AI-Chat?node-id=18-766",
        "Canvas",
    );
    assert_eq!(parsed, Some(FigmaDocument::new("n9ThKF7vJaGkvauPbXYLoR", "Canvas")));
    let name = |address: &str| FigmaDocument::parse(address, "").map(|document| document.name);
    assert_eq!(name("figma.com/board/Ab12/Design%20Review").as_deref(), Some("Design Review"));
    assert_eq!(name("https://FIGMA.COM/slides/A12/team-deck").as_deref(), Some("team deck"));
    for url in [
        "https://figma.com.evil.test/design/Ab1/Test",
        "https://www.figma.com/files/team/123",
        "http://figma.com/file/A1/X",
        "https://user@figma.com/file/A1/X",
        "https://figma.com:8443/file/A1/X",
        "https://figma.com/design/key",
        "https://figma.com/file/A_1/Test",
        "https://figma.com/file/%41/Test",
        "https://figma.com/file/ä/Test",
    ] {
        assert_eq!(FigmaDocument::parse(url, ""), None, "Accepted unexpected address: {url}");
    }
    let long = "x".repeat(600);
    let truncated = FigmaDocument::parse("https://figma.com/file/A1/Name", &long);
    assert_eq!(truncated.map(|document| document.name.chars().count()), Some(500));
}

#[test]
fn address_details_follow_foundation_parsing() {
    let name = |address: &str, title: &str| {
        FigmaDocument::parse(address, title).map(|document| (document.key, document.name))
    };
    let pair = |key: &str, name: &str| Some((key.to_string(), name.to_string()));
    assert_eq!(name("  https://www.figma.com/file/A1/My-File#frame  ", ""), pair("A1", "My File"));
    assert_eq!(name("https://figma.com:443//design//B2/x", ""), pair("B2", "x"));
    assert_eq!(name("FIGMA.COM/file/C3/y", ""), pair("C3", "y"));
    // A blank title falls back to the slug, a blank slug to the key; titles are kept as given.
    assert_eq!(name("https://figma.com/file/D4/---", "   "), pair("D4", "Figma file · D4"));
    assert_eq!(name("https://figma.com/file/D4/plan", " Plan "), pair("D4", " Plan "));
    for url in [
        "www.figma.com/file/A1/x",
        "https://figma.com/file/A1/My File",
        "https://figma.com/file/A1/x%zz",
        "https://:@figma.com/file/A1/x",
        "https://[::1]/file/A1/x",
        "https://figma.com/File/A1/x",
        "ftp://figma.com/file/A1/x",
    ] {
        assert_eq!(FigmaDocument::parse(url, ""), None, "{url}");
    }
    assert_eq!(FigmaDocument::new("A1", "z".repeat(501)).name.len(), 500);
}

#[test]
fn dwell_switch_return_and_long_absence() {
    let mut engine = FigmaActivation::new();
    let (a, b) = (a(), b());
    let steps: [(Option<&FigmaDocument>, f64, bool); 14] = [
        (Some(&a), 0.0, false),
        (Some(&a), 1.0, false),
        (Some(&a), 2.0, true),
        (Some(&a), 4.0, false),
        (Some(&b), 6.0, false),
        (Some(&b), 8.0, true),
        (Some(&a), 10.0, false),
        (Some(&a), 12.0, true),
        (None, 14.0, false),
        (Some(&a), 30.0, false),
        (Some(&a), 32.0, false),
        (None, 34.0, false),
        (Some(&a), 934.0, false),
        (Some(&a), 936.0, true),
    ];
    for (document, offset, expected) in steps {
        assert_eq!(engine.observe(document, after(offset)), expected, "at {offset} s");
    }
}

#[test]
fn interruptions_reset_dwell_and_missed_poll_is_not_continuous() {
    let mut engine = FigmaActivation::new();
    let a = a();
    assert!(!engine.observe(Some(&a), now()));
    assert!(!engine.observe(None, after(1.0)));
    assert!(!engine.observe(Some(&a), after(2.0)));
    assert!(!engine.observe(Some(&a), after(100.0)));
    assert!(engine.observe(Some(&a), after(102.0)));
}

#[test]
fn a_backwards_clock_does_not_reset_the_dwell() {
    // As in 1.14.2, only a forward gap of more than 6 s interrupts the dwell: the dwell that
    // began at 10 s survives the step back to 5 s and completes at 12 s.
    let mut engine = FigmaActivation::new();
    let a = a();
    assert!(!engine.observe(Some(&a), after(10.0)));
    assert!(!engine.observe(Some(&a), after(5.0)));
    assert!(!engine.observe(Some(&a), after(11.0)));
    assert!(engine.observe(Some(&a), after(12.0)));
}

#[test]
fn observe_is_metadata_only_and_activations_are_persistable() {
    let mut ledger = FigmaLedger::new();
    ledger.observe(&a());
    assert!(ledger.suggestions.is_empty() && ledger.history.is_empty());
    assert_eq!(ledger.files["Alpha12"].last_seen, None);
    let proposal = ledger.activate(&a(), now(), None, &prefs()).expect("a suggestion");
    ledger.observe(&FigmaDocument::new("Alpha12", "Renamed"));
    assert_eq!(ledger.files["Alpha12"].name, "Renamed");
    assert_eq!(ledger.files["Alpha12"].last_seen, Some(now()));
    assert_eq!(ledger.validate(proposal.id, after(5.0)).unwrap(), proposal);
    let json = serde_json::to_string(&ledger).unwrap();
    assert_eq!(serde_json::from_str::<FigmaLedger>(&json).unwrap(), ledger);
}

#[test]
fn suppression_expires_but_file_switch_clears_it() {
    let mut ledger = FigmaLedger::new();
    let proposal = ledger.activate(&a(), now(), None, &prefs()).expect("a suggestion");
    ledger.dismiss(proposal.id, now(), 15);
    assert!(ledger.activate(&a(), after(10.0), None, &prefs()).is_none());
    assert!(ledger.activate(&a(), after(900.0), None, &prefs()).is_some());
    let next = ledger.suggestions.first().expect("a suggestion").clone();
    ledger.dismiss(next.id, after(901.0), 120);
    ledger.activate(&b(), after(903.0), None, &prefs());
    assert!(ledger.activate(&a(), after(906.0), None, &prefs()).is_some());
    assert!(ledger.suggestions.len() == 1 && ledger.suggestions[0].file == "Alpha12");
    let current = ledger.suggestions[0].id;
    ledger.dismiss(current, after(907.0), 0);
    assert!(ledger.activate(&a(), after(908.0), None, &prefs()).is_some());
}

#[test]
fn links_invalidate_old_choices_and_current_ticket_suppresses() {
    let mut ledger = FigmaLedger::new();
    let proposal = ledger.activate(&a(), now(), None, &prefs()).expect("a suggestion");
    ledger.link("Alpha12", Some(42)).unwrap();
    assert!(ledger.validate(proposal.id, now()).is_err());
    assert!(ledger.activate(&a(), now(), Some(42), &prefs()).is_none());
    let linked = ledger.activate(&a(), now(), Some(43), &prefs()).expect("a linked suggestion");
    assert_eq!(linked.ticket_id, Some(42));
    assert!(ledger.validate(linked.id, after(86_401.0)).is_err());
    ledger.link("Alpha12", None).unwrap();
    assert!(ledger.files.contains_key("Alpha12"));
    assert!(!ledger.links.contains_key("Alpha12") && ledger.suggestions.is_empty());
}

#[test]
fn last_worked_uses_activations_and_migrates_mapping_only_storage() {
    let mut ledger: FigmaLedger = serde_json::from_str(r#"{"links":{"Legacy1":42}}"#).unwrap();
    assert_eq!(
        ledger.register().first().map(|file| file.name.as_str()),
        Some("Figma file · Legacy1")
    );
    ledger.activate(&a(), now(), None, &prefs());
    ledger.link("Alpha12", Some(42)).unwrap();
    ledger.activate(&b(), after(10.0), None, &prefs());
    ledger.link("Beta34", Some(42)).unwrap();
    let keys: Vec<String> = ledger.last_worked().into_iter().map(|file| file.key).collect();
    assert_eq!(keys, ["Beta34", "Alpha12", "Legacy1"]);
    ledger.history.clear();
    assert!(ledger.links.len() == 3 && ledger.register().len() == 3);
    assert_eq!(design_activity::selected(&[activity("design", "dEsIgN")]), Some("design"));
    assert_eq!(design_activity::selected(&[activity("dev", "Development")]), None);
    assert!(design_activity::matches(&activity("d", "  Design \n")));
}

#[test]
fn history_retention_and_workspace_isolation() {
    let mut prefs = prefs();
    prefs.history_days = 1;
    let mut ledger = FigmaLedger::new();
    ledger.activate(&a(), now(), None, &prefs);
    ledger.activate(&b(), after(86_401.0), None, &prefs);
    assert!(ledger.history.len() == 1 && ledger.history[0].file == "Beta34");
    let mut store = FigmaStore::default();
    store.workspaces.insert("org-a|workspace".to_string(), ledger);
    assert!(!store.workspaces.contains_key("org-b|workspace"));
}

#[test]
fn ticket_free_completion_clears_suggestion_and_preserves_saved_links() {
    let mut ledger = FigmaLedger::new();
    ledger.link("Alpha12", Some(42)).unwrap();
    ledger.activate(&a(), now(), None, &prefs());
    ledger.complete_tracking("Alpha12", None).unwrap();
    assert!(ledger.suggestions.is_empty());
    assert_eq!(ledger.links.get("Alpha12"), Some(&42));
    ledger.activate(&b(), now(), None, &prefs());
    ledger.complete_tracking("Beta34", None).unwrap();
    assert!(!ledger.links.contains_key("Beta34") && ledger.suggestions.is_empty());
    assert_eq!(ledger.files["Beta34"].name, "Board");
    ledger.complete_tracking("Beta34", Some(43)).unwrap();
    assert_eq!(ledger.links.get("Beta34"), Some(&43));
}

#[test]
fn links_need_a_known_file_key_and_a_valid_ticket() {
    let mut ledger = FigmaLedger::new();
    let invalid = [
        ("A_1", Some(42)),
        ("", Some(42)),
        ("title:", Some(42)),
        ("Alpha12", Some(0)),
        ("Alpha12", Some(-1)),
        ("Alpha12", Some(2_147_483_648)),
    ];
    for (key, ticket) in invalid {
        let error = ledger.link(key, ticket).unwrap_err();
        assert_eq!(
            error.to_string(),
            "Choose a valid file and Azure ticket number.",
            "{key} {ticket:?}"
        );
    }
    assert!(ledger.files.is_empty() && ledger.links.is_empty());
    ledger.link("Alpha12", Some(2_147_483_647)).unwrap();
    assert_eq!(ledger.files["Alpha12"].name, "Figma file · Alpha12");
    let error = ledger.validate(Uuid::new_v4(), now()).unwrap_err();
    assert_eq!(
        error.to_string(),
        "This Figma suggestion is outdated or its ticket link changed. Review the latest suggestion."
    );
}

#[test]
fn suggestions_are_fresh_for_a_day_and_keyed_by_signature() {
    let suggestion = FigmaSuggestion::new("Alpha12", "First design", Some(42), now());
    assert_eq!(suggestion.signature(), "Alpha12\u{0}42\u{0}First design");
    let unlinked = FigmaSuggestion::new("Alpha12", "First design", None, now());
    assert_eq!(unlinked.signature(), "Alpha12\u{0}\u{0}First design");
    assert!(suggestion.is_fresh(now()) && suggestion.is_fresh(after(86_400.0)));
    assert!(!suggestion.is_fresh(after(86_401.0)) && !suggestion.is_fresh(after(-1.0)));
}

#[test]
fn pruning_keeps_twelve_fresh_suggestions_live_dismissals_and_bounded_history() {
    let mut ledger = FigmaLedger::new();
    ledger.suggestions.push(FigmaSuggestion::new("Stale", "Old", None, after(-86_401.0)));
    for i in 0..14 {
        let created = after(f64::from(i) - 20.0);
        ledger.suggestions.push(FigmaSuggestion::new(format!("File{i}"), "Name", None, created));
    }
    ledger.suggestions.push(FigmaSuggestion::new("Future", "Later", None, after(100.0)));
    ledger.dismissals.insert("expired".to_string(), now());
    ledger.dismissals.insert("live".to_string(), after(1.0));
    ledger.prune(now(), &prefs());
    let files: Vec<&str> = ledger.suggestions.iter().map(|s| s.file.as_str()).collect();
    let expected: Vec<String> = (2..14).map(|i| format!("File{i}")).collect();
    assert_eq!(files, expected);
    assert_eq!(ledger.dismissals.keys().collect::<Vec<_>>(), ["live"]);

    // history_days is clamped to 1–365.
    let mut short = prefs();
    short.history_days = 0;
    ledger.history = vec![event("old", after(-86_400.0)), event("kept", after(-86_399.0))];
    ledger.prune(now(), &short);
    assert_eq!(ledger.history.iter().map(|e| e.file.as_str()).collect::<Vec<_>>(), ["kept"]);
    let mut long = prefs();
    long.history_days = 1_000;
    ledger.history =
        vec![event("old", after(-365.0 * 86_400.0)), event("kept", after(-364.0 * 86_400.0))];
    ledger.prune(now(), &long);
    assert_eq!(ledger.history.iter().map(|e| e.file.as_str()).collect::<Vec<_>>(), ["kept"]);

    // At most 5,000 events, newest last.
    ledger.history = (0..5_005).map(|i| event(&format!("F{i}"), after(-1.0))).collect();
    ledger.activate(&a(), now(), None, &prefs());
    assert_eq!(ledger.history.len(), 5_000);
    assert_eq!(ledger.history[0].file, "F6");
    assert_eq!(
        ledger.history.last().map(|e| (e.file.as_str(), e.kind.as_str())),
        Some(("Alpha12", "figma"))
    );
}

#[test]
fn dismissals_last_at_most_two_hours() {
    let mut ledger = FigmaLedger::new();
    let proposal = ledger.activate(&a(), now(), None, &prefs()).expect("a suggestion");
    ledger.dismiss(proposal.id, now(), 500);
    assert_eq!(ledger.dismissals.get(&proposal.signature()), Some(&after(7_200.0)));
    assert!(ledger.activate(&a(), after(7_199.0), None, &prefs()).is_none());
    assert!(ledger.activate(&a(), after(7_200.0), None, &prefs()).is_some());
    let pending = ledger.suggestions.clone();
    ledger.dismiss(Uuid::new_v4(), now(), 15);
    assert_eq!(ledger.suggestions, pending);
}

#[test]
fn window_titles_identify_files_without_an_address() {
    let cases = [
        ("Checkout flow – Figma", Some("Checkout flow")),
        ("Checkout flow - Figma", Some("Checkout flow")),
        ("  Wireframes v2  ", Some("Wireframes v2")),
        ("Design – System – Figma", Some("Design – System")),
        ("Figma", None),
        ("  ", None),
        ("", None),
    ];
    for (title, expected) in cases {
        let document = FigmaDocument::from_window_title(title);
        assert_eq!(document.as_ref().map(|d| d.name.as_str()), expected, "{title}");
        if let Some(document) = document {
            assert_eq!(document.key, format!("title:{}", document.name));
            assert!(FigmaDocument::is_title_key(&document.key));
            assert!(FigmaDocument::known_key(&document.key));
            // Title keys are never real keys, so they cannot collide and cannot be opened.
            assert!(!FigmaDocument::valid_key(&document.key));
            assert_eq!(FigmaDocument::web_url(&document.key), None);
            assert_eq!(FigmaDocument::desktop_url(&document.key), None);
        }
    }
    let long = FigmaDocument::from_window_title(&format!("{} – Figma", "y".repeat(600))).unwrap();
    assert_eq!(long.name.chars().count(), 500);
    assert_eq!(long.key.len(), "title:".len() + 500);
    for key in ["title:", "title:  ", "Alpha12", "title:a\u{0}b"] {
        assert!(!FigmaDocument::is_title_key(key), "{key:?}");
    }
    assert_eq!(
        FigmaDocument::web_url("Alpha12").as_deref(),
        Some("https://www.figma.com/file/Alpha12")
    );
    assert_eq!(FigmaDocument::desktop_url("Alpha12").as_deref(), Some("figma://file/Alpha12"));
}

#[test]
fn window_reads_prefer_the_address_and_fall_back_to_the_title_on_windows() {
    let url = Some("https://www.figma.com/design/Alpha12/first-design");
    let titled = Some("First design – Figma");
    // macOS keeps 1.14.2: the raw title names an addressed file; no address means NoAddress.
    let mac = FigmaObservation::from_window(url, titled, HostOs::Macos);
    assert_eq!(mac, FigmaObservation::File(FigmaDocument::new("Alpha12", "First design – Figma")));
    assert_eq!(
        FigmaObservation::from_window(None, titled, HostOs::Macos),
        FigmaObservation::NoAddress
    );
    // Windows drops the suffix, keeps the real key when the address is readable, else the title.
    let win = FigmaObservation::from_window(url, titled, HostOs::Windows);
    assert_eq!(win, FigmaObservation::File(FigmaDocument::new("Alpha12", "First design")));
    let untitled = FigmaObservation::from_window(url, Some("Figma"), HostOs::Windows);
    assert_eq!(untitled.document().map(|d| d.name.as_str()), Some("first design"));
    let title_only = FigmaObservation::from_window(None, titled, HostOs::Windows);
    assert_eq!(title_only.document().map(|d| d.key.as_str()), Some("title:First design"));
    let other_site = Some("https://example.com/design/Alpha12/x");
    let fallback = FigmaObservation::from_window(other_site, Some("Plan - Figma"), HostOs::Windows);
    assert_eq!(fallback.document().map(|d| d.key.as_str()), Some("title:Plan"));
    assert_eq!(
        FigmaObservation::from_window(None, Some("Figma"), HostOs::Windows),
        FigmaObservation::NoAddress
    );
    assert_eq!(
        FigmaObservation::from_window(None, None, HostOs::Windows),
        FigmaObservation::NoAddress
    );
    assert!(title_only.foreground() && FigmaObservation::NoAddress.foreground());
    assert!(
        !FigmaObservation::Waiting.foreground() && !FigmaObservation::MissingAccess.foreground()
    );
    assert_eq!(FigmaObservation::NoAddress.document(), None);
}

#[test]
fn title_identified_files_use_the_same_dwell_activation_and_suggestions() {
    let document = FigmaDocument::from_window_title("Checkout flow – Figma").unwrap();
    let mut activation = FigmaActivation::new();
    assert!(!activation.observe(Some(&document), now()));
    assert!(activation.observe(Some(&document), after(2.0)));
    let mut ledger = FigmaLedger::new();
    let proposal = ledger.activate(&document, after(2.0), None, &prefs()).expect("a suggestion");
    assert_eq!(proposal.file, "title:Checkout flow");
    assert_eq!((proposal.name.as_str(), proposal.ticket_id), ("Checkout flow", None));
    ledger.dismiss(proposal.id, after(3.0), 15);
    assert!(ledger.activate(&document, after(4.0), None, &prefs()).is_none());
    ledger.link(&document.key, Some(42)).unwrap();
    assert!(ledger.dismissals.is_empty());
    assert!(ledger.activate(&document, after(5.0), Some(42), &prefs()).is_none());
    let linked = ledger.activate(&document, after(6.0), None, &prefs()).expect("a suggestion");
    assert_eq!(linked.ticket_id, Some(42));
    assert_eq!(ledger.validate(linked.id, after(7.0)).unwrap(), linked);
    let first = ledger.register().into_iter().next().expect("a file");
    assert_eq!((first.key.as_str(), first.name.as_str()), ("title:Checkout flow", "Checkout flow"));
    assert_eq!(ledger.last_worked().len(), 1);
    // A title link made before any activation, or from storage, is named after the title.
    let mut fresh = FigmaLedger::new();
    fresh.link("title:Roadmap", Some(7)).unwrap();
    assert_eq!(fresh.files["title:Roadmap"].name, "Roadmap");
    let stored: FigmaLedger = serde_json::from_str(r#"{"links":{"title:Roadmap":7}}"#).unwrap();
    assert_eq!(stored.register()[0].name, "Roadmap");
}

#[test]
fn swift_figma_store_decodes_with_nul_separated_dismissal_keys() {
    let json = r#"{"workspaces":{"org|https://org.timehub.7pace.com/":{
        "files":{"Alpha12":{"key":"Alpha12","name":"First design","lastSeen":SEEN},
                 "Beta34":{"key":"Beta34","name":"Board"}},
        "links":{"Alpha12":42},
        "suggestions":[{"id":"0F7F2C52-6D0B-4A0E-9C8D-3B1C2D4E5F60","file":"Alpha12",
                        "name":"First design","ticketID":42,"created":CREATED}],
        "dismissals":{"Beta34\u0000\u0000Board":UNTIL},
        "history":[{"id":"1A2B3C4D-0000-4000-8000-000000000001","timestamp":SEEN,"kind":"figma",
                    "file":"Alpha12","name":"First design","ticketID":42},
                   {"id":"1A2B3C4D-0000-4000-8000-000000000002","timestamp":SEEN,"kind":"figma",
                    "file":"Beta34","name":"Board"}]}}}"#
        .replace("SEEN", &swift(now()).to_string())
        .replace("CREATED", &swift(after(5.0)).to_string())
        .replace("UNTIL", &swift(after(900.0)).to_string());
    let store: FigmaStore = serde_json::from_str(&json).unwrap();
    let mut ledger = store.workspaces["org|https://org.timehub.7pace.com/"].clone();
    assert_eq!(ledger.files["Alpha12"].last_seen, Some(now()));
    assert_eq!(ledger.files["Beta34"].last_seen, None);
    assert_eq!(ledger.links.get("Alpha12"), Some(&42));
    let suggestion = ledger.suggestions[0].clone();
    assert_eq!(suggestion.id.to_string(), "0f7f2c52-6d0b-4a0e-9c8d-3b1c2d4e5f60");
    assert_eq!((suggestion.ticket_id, suggestion.created), (Some(42), after(5.0)));
    assert_eq!(ledger.dismissals.get("Beta34\u{0}\u{0}Board"), Some(&after(900.0)));
    assert_eq!(ledger.history[1].ticket_id, None);
    assert_eq!(ledger.validate(suggestion.id, after(10.0)).unwrap(), suggestion);
    // The stored dismissal still hides Board's suggestion.
    assert!(ledger.activate(&b(), after(10.0), None, &prefs()).is_none());
    // Writes camelCase keys and RFC 3339 dates, and reads them back.
    let written = serde_json::to_value(&store).unwrap();
    let workspace = &written["workspaces"]["org|https://org.timehub.7pace.com/"];
    assert_eq!(workspace["suggestions"][0]["ticketId"], 42);
    assert!(workspace["files"]["Alpha12"]["lastSeen"].is_string());
    assert!(workspace["files"]["Beta34"].get("lastSeen").is_none());
    assert!(workspace["history"][1].get("ticketId").is_none());
    assert!(workspace["dismissals"]["Beta34\u{0}\u{0}Board"].is_string());
    assert_eq!(serde_json::from_value::<FigmaStore>(written).unwrap(), store);
}

#[test]
fn ledgers_and_preferences_decode_tolerantly_like_swift() {
    let nulls =
        r#"{"files":null,"links":null,"suggestions":null,"dismissals":null,"history":null}"#;
    for json in ["{}", nulls] {
        assert_eq!(
            serde_json::from_str::<FigmaLedger>(json).unwrap(),
            FigmaLedger::default(),
            "{json}"
        );
    }
    assert_eq!(serde_json::from_str::<FigmaStore>("{}").unwrap(), FigmaStore::default());
    // As in Swift, a value that is present but malformed is still an error.
    assert!(serde_json::from_str::<FigmaLedger>(r#"{"links":{"Alpha12":"42"}}"#).is_err());
    let swift_json = r#"{"enabled":true,"dismissalMinutes":30,"historyDays":90}"#;
    let preferences: FigmaPreferences = serde_json::from_str(swift_json).unwrap();
    assert_eq!(
        preferences,
        FigmaPreferences { enabled: true, dismissal_minutes: 30, history_days: 90 }
    );
    assert_eq!(serde_json::to_string(&preferences).unwrap(), swift_json);
    let defaults: FigmaPreferences = serde_json::from_str("{}").unwrap();
    assert_eq!(
        defaults,
        FigmaPreferences { enabled: false, dismissal_minutes: 15, history_days: 30 }
    );
}

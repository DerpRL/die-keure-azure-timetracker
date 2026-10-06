//! Figma: observation → dwell activation → suggestion → Design start with the file name as the
//! comment; links, opening files and Design revalidation.

mod support;

use serde_json::{Value, json};

use att_platform::WindowObservation;
use support::*;

fn figma_configuration() -> att_core::Configuration {
    let mut config = configuration(vec![]);
    config.figma.enabled = true;
    config
}

async fn observe(h: &Harness, observation: WindowObservation, after: f64) {
    h.advance(after);
    *h.t.figma.observation.lock().unwrap() = observation;
    att_engine::session::sample_figma(h.engine()).await;
    settle().await;
}

fn checkout() -> WindowObservation {
    WindowObservation::Window {
        title: Some("Checkout flow".into()),
        url: Some("https://www.figma.com/design/AbC123/Checkout-flow".into()),
    }
}

/// Two seconds of focus activate the file.
async fn activate(h: &Harness) -> Value {
    observe(h, checkout(), 0.0).await;
    assert_eq!(h.slice("prompts")["figma"], json!([]), "a dwell first");
    observe(h, checkout(), 2.0).await;
    h.slice("prompts")["figma"][0].clone()
}

#[tokio::test]
async fn an_active_figma_file_suggests_design_with_the_file_name_as_comment() {
    let h = Harness::new(figma_configuration());
    h.start().await;
    h.shell();
    let prompt = activate(&h).await;
    assert_eq!(prompt["suggestion"]["name"], "Checkout flow");
    assert_eq!(prompt["suggestion"]["file"], "AbC123");
    assert_eq!(prompt["suggestion"]["ticketId"], Value::Null);
    let id = prompt["suggestion"]["id"].as_str().unwrap().to_string();
    assert_eq!(h.shell(), vec!["show_panel(focus=false)".to_string(), format!("notify({id})")]);
    let figma = h.slice("figma");
    assert_eq!(figma["status"], "file");
    assert_eq!(figma["label"], "File: Checkout flow");
    assert_eq!(figma["files"][0]["webUrl"], "https://www.figma.com/file/AbC123");

    h.ok(json!({"type": "figma.track", "suggestionId": id, "useLinkedTicket": true})).await;
    let draft = h.slice("flow")["draft"].clone();
    assert_eq!(draft["source"], "figma");
    assert_eq!(draft["isFigma"], true);
    assert_eq!(draft["allowedActivityIds"], json!(["design"]));
    assert_eq!(draft["startableActivityIds"], json!(["design"]));
    assert_eq!(draft["preferredActivityId"], "design");
    assert_eq!(draft["remark"], "Checkout flow");

    // Only Design starts from Figma.
    let draft_id = draft["id"].as_str().unwrap().to_string();
    h.ok(json!({"type": "tracking.start", "draftId": draft_id, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    assert!(h.seven_pace.writes().is_empty());
    assert_eq!(h.slice("app")["error"], "Choose Design to start tracking from Figma.");

    h.ok(json!({"type": "figma.track", "suggestionId": id, "useLinkedTicket": true})).await;
    let draft_id = h.slice("flow")["draft"]["id"].as_str().unwrap().to_string();
    h.ok(json!({"type": "tracking.start", "draftId": draft_id, "activityId": "design", "comment": "", "includeTicket": true})).await;
    assert_eq!(h.seven_pace.writes(), vec![r#"start(None,Some("design"),Some("Checkout flow"))"#.to_string()]);
    assert_eq!(h.slice("prompts")["figma"], json!([]), "the suggestion is resolved");
    let audit = h.slice("history")["audit"].clone();
    assert_eq!(audit[0]["detail"], "Checkout flow · Design");
}

#[tokio::test]
async fn linked_files_suggest_their_ticket_and_links_are_verified() {
    let h = Harness::new(figma_configuration());
    h.start().await;
    activate(&h).await;
    h.ok(json!({"type": "figma.link", "fileKey": "AbC123", "ticketId": 999999})).await;
    assert_eq!(h.slice("app")["error"], "Azure ticket #999999 was not found or is not accessible.");
    assert_eq!(h.slice("figma")["files"][0]["ticketId"], Value::Null);
    h.ok(json!({"type": "figma.link", "fileKey": "AbC123", "ticketId": 4790})).await;
    let file = h.slice("figma")["files"][0].clone();
    assert_eq!(file["ticketId"], 4790);
    assert_eq!(file["ticketTitle"], "Invoice VAT number");
    assert_eq!(h.slice("prompts")["figma"], json!([]), "linking clears the old suggestion");

    // Away for 15 minutes, then back: the linked ticket is suggested.
    observe(&h, WindowObservation::NotForeground, 1.0).await;
    observe(&h, WindowObservation::NotForeground, 15.0 * 60.0).await;
    observe(&h, checkout(), 2.0).await;
    observe(&h, checkout(), 2.0).await;
    let prompt = h.slice("prompts")["figma"][0].clone();
    assert_eq!(prompt["suggestion"]["ticketId"], 4790);
    assert_eq!(prompt["ticketTitle"], "Invoice VAT number");
    let id = prompt["suggestion"]["id"].clone();
    h.ok(json!({"type": "figma.track", "suggestionId": id, "useLinkedTicket": true})).await;
    let draft = h.slice("flow")["draft"].clone();
    assert_eq!(draft["item"]["id"], 4790);
    h.ok(json!({"type": "tracking.start", "draftId": draft["id"], "activityId": "design", "comment": "", "includeTicket": true})).await;
    assert_eq!(h.seven_pace.writes(), vec![r#"start(Some(4790),Some("design"),Some("Checkout flow"))"#.to_string()]);

    h.ok(json!({"type": "figma.unlink", "fileKey": "AbC123"})).await;
    assert_eq!(h.slice("figma")["files"][0]["ticketId"], Value::Null);
}

#[tokio::test]
async fn keep_tracking_hides_a_suggestion_and_files_open_by_address() {
    let h = Harness::new(figma_configuration());
    h.start().await;
    let prompt = activate(&h).await;
    h.shell();
    h.ok(json!({"type": "figma.keep", "suggestionId": prompt["suggestion"]["id"]})).await;
    assert_eq!(h.slice("prompts")["figma"], json!([]));
    let id = prompt["suggestion"]["id"].as_str().unwrap();
    assert_eq!(h.shell(), vec![format!("remove_notification({id})")]);

    h.ok(json!({"type": "figma.open", "fileKey": "AbC123", "desktop": true})).await;
    h.ok(json!({"type": "figma.open", "fileKey": "AbC123", "desktop": false})).await;
    assert_eq!(
        h.shell(),
        vec!["open_url(figma://file/AbC123)".to_string(), "open_url(https://www.figma.com/file/AbC123)".to_string()]
    );
    h.ok(json!({"type": "figma.open", "fileKey": "title:Checkout", "desktop": false})).await;
    assert_eq!(h.slice("app")["error"], "This Figma file key is invalid.");

    h.ok(json!({"type": "figma.setSearch", "query": "nothing"})).await;
    assert_eq!(h.slice("figma")["files"], json!([]));
    h.ok(json!({"type": "figma.setSearch", "query": "checkout"})).await;
    assert_eq!(h.slice("figma")["files"][0]["key"], "AbC123");
    assert_eq!(h.slice("figma")["historyCount"], 1);
    h.ok(json!({"type": "figma.clearHistory"})).await;
    assert_eq!(h.slice("figma")["history"], json!([]));
}

#[tokio::test]
async fn pausing_watching_pauses_figma_and_disabling_clears_suggestions() {
    let h = Harness::new(figma_configuration());
    h.start().await;
    activate(&h).await;
    h.ok(json!({"type": "repositories.toggleWatching"})).await;
    assert_eq!(h.slice("prompts")["figma"], json!([]));
    assert_eq!(h.slice("figma")["label"], "Paused");
    observe(&h, checkout(), 2.0).await;
    observe(&h, checkout(), 2.0).await;
    assert_eq!(h.slice("prompts")["figma"], json!([]), "no observation while paused");
    h.ok(json!({"type": "repositories.toggleWatching"})).await;
    let preferences = json!({"enabled": false, "dismissalMinutes": 500, "historyDays": 0});
    h.ok(json!({"type": "figma.setPreferences", "preferences": preferences})).await;
    let figma = h.slice("figma");
    assert_eq!(figma["preferences"], json!({"enabled": false, "dismissalMinutes": 120, "historyDays": 1}));
    assert_eq!(figma["label"], "Disabled");
}

#[tokio::test]
async fn windows_identifies_files_by_window_title() {
    // A title-only observation on macOS is "no address", as in 1.14.2.
    let h = Harness::new(figma_configuration());
    h.start().await;
    let title_only = WindowObservation::Window { title: Some("Checkout flow – Figma".into()), url: None };
    observe(&h, title_only.clone(), 0.0).await;
    observe(&h, title_only, 2.0).await;
    assert_eq!(h.slice("figma")["status"], "noAddress");
    assert_eq!(h.slice("prompts")["figma"], json!([]));
}

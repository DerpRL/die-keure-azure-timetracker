//! The ticket context panel (port of `TicketContextModel` and `AppModel.openTicket`).

#[path = "support/controllers.rs"]
mod support;

use serde_json::json;

use att_core::Configuration;
use att_engine::controllers::testing;
use support::*;

#[tokio::test]
async fn a_newer_ticket_or_closing_the_panel_drops_an_older_answer() {
    let h = Harness::new(Vec::new()).await;
    let hold = h.azure.hold_next();
    let engine = h.t.engine.clone();
    let first = tokio::spawn(async move {
        engine.dispatch(json!({"type": "ticket.showContext", "ticketId": 1})).await
    });
    eventually("the first request", || h.azure.calls().len() == 1).await;
    assert_eq!(h.slice("ticketContext")["loading"], true);
    h.ok(json!({"type": "ticket.showContext", "ticketId": 2})).await;
    hold.notify_one();
    first.await.unwrap().unwrap();
    let context = h.slice("ticketContext");
    assert_eq!(context["ticketId"], 2);
    assert_eq!(context["details"]["title"], "Ticket 2");
    assert_eq!(context["loading"], false);
    assert_eq!(context["azureUrl"], "https://dev.azure.com/acme/_workitems/edit/2");

    let hold = h.azure.hold_next();
    let engine = h.t.engine.clone();
    let late = tokio::spawn(async move {
        engine.dispatch(json!({"type": "ticket.showContext", "ticketId": 1})).await
    });
    eventually("the second request", || h.azure.calls().len() == 3).await;
    h.ok(json!({"type": "ticket.closeContext"})).await;
    hold.notify_one();
    late.await.unwrap().unwrap();
    let context = h.slice("ticketContext");
    assert!(context["ticketId"].is_null());
    assert!(context["details"].is_null());
    assert_eq!(context["loading"], false);
}

#[tokio::test]
async fn azure_errors_and_a_missing_azure_connection_are_explained() {
    let h = Harness::new(Vec::new()).await;
    h.ok(json!({"type": "ticket.showContext", "ticketId": 99})).await;
    assert_eq!(
        h.slice("ticketContext")["issue"],
        "The requested entry or API endpoint was not found."
    );

    testing::install_clients(&h.t.engine, Some(clients(&h.seven_pace, None))).await;
    h.ok(json!({"type": "ticket.showContext", "ticketId": 7})).await;
    let context = h.slice("ticketContext");
    assert_eq!(
        context["issue"],
        "Add your Azure organization and PAT in Settings to load ticket details."
    );
    assert_eq!(context["ticketId"], 7);
    assert_eq!(context["loading"], false);
}

#[tokio::test]
async fn tickets_open_in_azure_devops_in_the_browser() {
    let h = Harness::new(Vec::new()).await;
    h.t.shell.take();
    h.ok(json!({"type": "ticket.openInAzure", "ticketId": 42})).await;
    assert_eq!(h.t.shell.take(), ["open_url(https://dev.azure.com/acme/_workitems/edit/42)"]);

    // Without a valid organization nothing opens, as in 1.14.x.
    let config = Configuration { organization: "not an org".into(), ..configuration() };
    let h = Harness::on(store_with(&config), FakeSevenPace::default()).await;
    h.t.shell.take();
    h.ok(json!({"type": "ticket.openInAzure", "ticketId": 42})).await;
    assert!(h.t.shell.take().is_empty());
}

#[tokio::test]
async fn a_reconnect_closes_the_panel() {
    let h = Harness::new(Vec::new()).await;
    h.ok(json!({"type": "ticket.showContext", "ticketId": 1})).await;
    assert_eq!(h.slice("ticketContext")["details"]["id"], 1);
    testing::install_clients(&h.t.engine, None).await;
    let context = h.slice("ticketContext");
    assert!(context["ticketId"].is_null());
    assert!(context["details"].is_null());
}

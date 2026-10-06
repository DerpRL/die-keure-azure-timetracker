//! Port of WorkOperationsTests.swift › WorkInsightTests ›
//! `htmlAndTicketDetailsHandleIdentityFieldsAndRejectUnsafeLinks`, plus the remaining rules of
//! TicketContext.swift (`TicketContext.decode`, `PlainHTML.text`) and the strict URI splitter.

use att_core::AppError;
use att_core::ticket_context::{TicketContext, TicketLink, UriParts, plain_html};
use serde_json::json;

const ORGANIZATION: &str = "https://dev.azure.com/test";

fn decode(value: serde_json::Value) -> TicketContext {
    TicketContext::decode(value.to_string().as_bytes(), ORGANIZATION).unwrap()
}

#[test]
fn html_and_ticket_details_handle_identity_fields_and_reject_unsafe_links() {
    let data = br#"{"id":123,"fields":{"System.Title":"Test","System.AssignedTo":{"displayName":"Alex"},"System.Description":"<p>Hello &amp; welcome</p><script>bad()</script><img src='https://example.com/pixel'>","Microsoft.VSTS.Common.AcceptanceCriteria":"<li>Done &#10003;</li>"},"relations":[{"url":"javascript:alert(1)"},{"url":"https://dev.azure.com/test/_apis/wit/workItems/456","attributes":{"name":"Parent"}}]}"#;
    let result = TicketContext::decode(data, ORGANIZATION).unwrap();
    assert_eq!(result.assigned_to, "Alex");
    assert_eq!(result.description, "Hello & welcome");
    assert_eq!(result.acceptance_criteria, "• Done ✓");
    assert_eq!(result.links.len(), 1);
    assert_eq!(result.links[0].url, "https://dev.azure.com/test/_workitems/edit/456");
    assert_eq!(result.links[0].title, "Parent");
    assert_eq!(result.links[0].id(), result.links[0].url);
}

#[test]
fn fields_default_to_empty_text_and_identity_may_be_plain_text() {
    let result = decode(json!({"id": 7, "fields": {
        "System.Title": "Fix", "System.State": "Active", "System.WorkItemType": "Bug",
        "System.AssignedTo": "Sam <sam@example.com>", "System.TeamProject": "Project",
        "System.IterationPath": "Project\\Sprint 1", "System.Tags": "a; b",
        "System.Description": 5
    }}));
    assert_eq!(result.id, 7);
    assert_eq!(result.title, "Fix");
    assert_eq!(result.state, "Active");
    assert_eq!(result.kind, "Bug");
    assert_eq!(result.assigned_to, "Sam <sam@example.com>");
    assert_eq!(result.project, "Project");
    assert_eq!(result.iteration, "Project\\Sprint 1");
    assert_eq!(result.tags, "a; b");
    assert_eq!(result.description, "");
    assert_eq!(result.acceptance_criteria, "");
    assert!(result.links.is_empty());
    let unnamed = decode(json!({"id": 7.0, "fields": {"System.AssignedTo": {"id": "x"}}}));
    assert_eq!(unnamed.id, 7);
    assert_eq!(unnamed.assigned_to, "");
}

#[test]
fn incomplete_details_are_rejected_without_echoing_the_body() {
    for body in [
        "[]",
        "null",
        "not json secret-value",
        r#"{"fields":{}}"#,
        r#"{"id":"123","fields":{}}"#,
        r#"{"id":1.5,"fields":{}}"#,
        r#"{"id":123}"#,
        r#"{"id":123,"fields":"secret-value"}"#,
    ] {
        let error = TicketContext::decode(body.as_bytes(), ORGANIZATION).unwrap_err();
        assert_eq!(error, AppError::message("Azure returned incomplete ticket details."), "{body}");
    }
}

#[test]
fn relations_keep_safe_links_once_with_names() {
    let result = decode(json!({"id": 1, "fields": {}, "relations": [
        {"url": "http://example.com/plain"},
        {"url": "https://user@example.com/credentials"},
        {"url": "https://user:pw@example.com/credentials"},
        {"url": "https://example.com/has space"},
        {"url": "https:///no-host"},
        {"url": 42},
        {"rel": "Hyperlink"},
        {"url": "https://example.com/doc", "rel": "Hyperlink"},
        {"url": "https://example.com/doc", "attributes": {"name": "Duplicate"}},
        {"url": "https://example.com/other", "attributes": {"comment": "no name"}},
        {"url": "https://dev.azure.com/test/_apis/wit/workItems/7", "rel": "System.LinkTypes.Hierarchy-Reverse"},
        {"url": "https://dev.azure.com/test/_apis/wit/workitems/7/", "attributes": {"name": "Same ticket"}},
        {"url": "https://dev.azure.com/testing/_apis/wit/workItems/8"},
        {"url": "https://DEV.azure.com/test/_apis/wit/workItems/9"},
        {"url": "https://dev.azure.com/test/_apis/wit/workItems/latest"},
        {"url": "https://dev.azure.com/test/Project/_apis/wit/workItems/10?api-version=7.1"}
    ]}));
    let links: Vec<(&str, &str)> =
        result.links.iter().map(|link| (link.title.as_str(), link.url.as_str())).collect();
    assert_eq!(
        links,
        [
            ("Hyperlink", "https://example.com/doc"),
            ("Related link", "https://example.com/other"),
            ("System.LinkTypes.Hierarchy-Reverse", "https://dev.azure.com/test/_workitems/edit/7"),
            ("Related link", "https://dev.azure.com/testing/_apis/wit/workItems/8"),
            ("Related link", "https://DEV.azure.com/test/_apis/wit/workItems/9"),
            ("Related link", "https://dev.azure.com/test/_apis/wit/workItems/latest"),
            ("Related link", "https://dev.azure.com/test/_workitems/edit/10"),
        ]
    );
}

#[test]
fn a_relation_that_is_not_an_object_drops_every_link_like_swift() {
    let result = decode(json!({"id": 1, "fields": {}, "relations": [
        {"url": "https://example.com/doc"}, "https://example.com/text"
    ]}));
    assert!(result.links.is_empty());
}

#[test]
fn plain_html_removes_scripts_and_styles_case_insensitively() {
    assert_eq!(
        plain_html::text("<SCRIPT type=\"x\">a\nb</script >keep<style>p { }</STYLE>"),
        "keep"
    );
    // The leftmost opening tag decides which closing tag ends the block.
    assert_eq!(plain_html::text("<style> a <script> b </style> c </script>"), "c");
    // Only whole tag names: `<scripts>` is an ordinary tag.
    assert_eq!(plain_html::text("<scripts>x</scripts>"), "x");
    // An unclosed script is just a tag.
    assert_eq!(plain_html::text("<script>never closed"), "never closed");
}

#[test]
fn plain_html_turns_blocks_into_lines_and_list_items_into_bullets() {
    assert_eq!(plain_html::text("a<br>b<BR />c</div>d</H2 >e</tr>f</p >g"), "a\nb\nc\nd\ne\nf\ng");
    assert_eq!(
        plain_html::text("<ul><li>One</li><LI class=\"x\">Two</li><link rel=x></ul>"),
        "• One\n• Two"
    );
}

#[test]
fn plain_html_decodes_entities_after_removing_tags() {
    assert_eq!(
        plain_html::text("&#x41;&#65;&#X41;&#xD800;&#99999999999;"),
        "AA&#X41;&#xD800;&#99999999999;"
    );
    assert_eq!(plain_html::text("&lt;b&gt;&quot;x&quot;&apos;&nbsp;1"), "<b>\"x\"' 1");
    // Decoded markup is text, not a tag.
    assert_eq!(
        plain_html::text("&lt;script&gt;alert(1)&lt;/script&gt;"),
        "<script>alert(1)</script>"
    );
    // `&amp;` is decoded last, and numeric entities first, exactly as in Swift.
    assert_eq!(plain_html::text("&amp;lt; &#38;lt;"), "&lt; <");
    assert_eq!(plain_html::text("  <p> x </p>\n "), "x");
    assert_eq!(plain_html::text(""), "");
}

#[test]
fn uri_parts_split_like_url_components() {
    let parts = UriParts::parse("https://user:pw@host.example:8443/a%20b/c/?x=1&y=2#frag").unwrap();
    assert_eq!(parts.scheme, Some("https"));
    assert_eq!(parts.user_info, Some("user:pw"));
    assert_eq!(parts.host, Some("host.example"));
    assert_eq!(parts.port, Some("8443"));
    assert_eq!(parts.path, "/a%20b/c/");
    assert_eq!(parts.query, Some("x=1&y=2"));
    assert_eq!(parts.fragment, Some("frag"));
    assert_eq!(parts.path_decoded().as_deref(), Some("/a b/c"));
    assert_eq!(UriParts::parse("https://@host").unwrap().user_info, Some(""));
    let literal = UriParts::parse("https://[::1]:443/").unwrap();
    assert_eq!((literal.host, literal.port), (Some("[::1]"), Some("443")));
    let no_authority = UriParts::parse("https:host").unwrap();
    assert_eq!((no_authority.host, no_authority.path), (None, "host"));
    assert_eq!(UriParts::parse("https://h/").unwrap().path_decoded().as_deref(), Some("/"));
    for invalid in [
        "https://host/a b",
        "https://host/%zz",
        "https://host/%2",
        "https://ho st",
        "https://host:44a",
        "1https://host",
        ":no-scheme",
        "https://host#a#b",
        "https://hôst",
        "https://host\\path",
        "https://[::1",
    ] {
        assert_eq!(UriParts::parse(invalid), None, "{invalid:?}");
    }
}

#[test]
fn ticket_context_serializes_for_the_ui() {
    let context = decode(json!({"id": 3, "fields": {"System.WorkItemType": "Task"},
        "relations": [{"url": "https://example.com/doc", "rel": "Hyperlink"}]}));
    let value = serde_json::to_value(&context).unwrap();
    assert_eq!(value["type"], "Task");
    assert_eq!(value["assignedTo"], "");
    assert_eq!(value["acceptanceCriteria"], "");
    assert_eq!(value["links"], json!([{"title": "Hyperlink", "url": "https://example.com/doc"}]));
    let back: TicketContext = serde_json::from_value(value).unwrap();
    assert_eq!(back, context);
    let link = TicketLink { title: "x".into(), url: "https://example.com".into() };
    assert_eq!(link.id(), "https://example.com");
}

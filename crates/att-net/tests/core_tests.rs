//! Endpoint tests from Tests/AzureTimetrackerCoreTests/CoreTests.swift (`DecodingTests`), plus
//! the accepted forms and the Azure organization rule from `Endpoint` in API.swift.

use att_net::Endpoint;

const SEVEN_PACE_MESSAGE: &str =
    "Use your 7pace workspace URL: https://your-organization.timehub.7pace.com";

#[test]
fn rejects_unsafe_endpoints() {
    for url in [
        "http://org.timehub.7pace.com",
        "https://org.timehub.7pace.com.evil.test",
        "https://user:secret@org.timehub.7pace.com",
        "https://org.timehub.7pace.com/api",
        "https://org.timehub.7pace.com?foo=bar",
    ] {
        assert!(Endpoint::seven_pace(url).is_err(), "{url}");
    }
}

#[test]
fn rejects_every_other_unsafe_or_malformed_workspace_url_with_the_swift_message() {
    for url in [
        "",
        "org.timehub.7pace.com",
        "https:org.timehub.7pace.com",
        "https:/org.timehub.7pace.com",
        "https://@org.timehub.7pace.com",
        "https://user@org.timehub.7pace.com",
        "https://org.timehub.7pace.com?",
        "https://org.timehub.7pace.com#",
        "https://org.timehub.7pace.com#top",
        "https://org.timehub.7pace.com:8443",
        "https://org.timehub.7pace.com:https",
        "https://org.timehub.7pace.com//",
        "https://org.timehub.7pace.com/%2F",
        "https://timehub.7pace.com",
        "https://org timehub.7pace.com",
        "https://org.timehub.7pace.com\\@evil.test",
        "https://evil.test#.timehub.7pace.com",
        "https://evil.test?.timehub.7pace.com",
        "https://evil.test/.timehub.7pace.com",
        "https://org.timehub.7pace.com.",
        "ftp://org.timehub.7pace.com",
        "wss://org.timehub.7pace.com",
    ] {
        let error = Endpoint::seven_pace(url).unwrap_err();
        assert_eq!(error.to_string(), SEVEN_PACE_MESSAGE, "{url:?}");
    }
}

#[test]
fn accepts_workspace_urls_trimmed_on_the_default_port() {
    for (input, expected) in [
        ("https://org.timehub.7pace.com", "https://org.timehub.7pace.com/"),
        ("https://org.timehub.7pace.com/", "https://org.timehub.7pace.com/"),
        ("  https://Org.TimeHub.7pace.com:443\n", "https://org.timehub.7pace.com/"),
        ("https://my-org.timehub.7pace.com:", "https://my-org.timehub.7pace.com/"),
    ] {
        let url = Endpoint::seven_pace(input).unwrap();
        assert_eq!(url.as_str(), expected, "{input:?}");
    }
}

#[test]
fn azure_organizations_follow_the_swift_pattern() {
    assert_eq!(Endpoint::azure(" example \n").unwrap().as_str(), "https://dev.azure.com/example");
    assert_eq!(Endpoint::azure("My_Org-2").unwrap().as_str(), "https://dev.azure.com/My_Org-2");
    assert_eq!(Endpoint::azure("0rg").unwrap().as_str(), "https://dev.azure.com/0rg");
    for organization in
        ["", " ", "-org", "_org", "my org", "org/x", "org.x", "örg", "org?x", "dev.azure.com/org"]
    {
        let error = Endpoint::azure(organization).unwrap_err();
        assert_eq!(
            error.to_string(),
            "Enter the organization name from dev.azure.com/your-organization.",
            "{organization:?}"
        );
    }
}

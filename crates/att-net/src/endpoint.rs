//! Workspace URL validation. Ported from `Endpoint` in API.swift.
//!
//! This is where HTTPS is enforced: production code builds every client from these URLs.

use reqwest::Url;

use att_core::ticket_context::UriParts;
use att_core::{AppError, Result};

const SEVEN_PACE_HOST_SUFFIX: &str = ".timehub.7pace.com";

/// Builds the base URLs of the 7pace and Azure DevOps APIs from user input.
pub enum Endpoint {}

impl Endpoint {
    /// `https://<organization>.timehub.7pace.com`, trimmed. Rejects any other scheme or host, a
    /// user or password (even an empty `@`), a query or fragment (even an empty `?` or `#`), a
    /// port other than 443 and any path except `/`.
    pub fn seven_pace(text: &str) -> Result<Url> {
        let invalid = || {
            AppError::message(
                "Use your 7pace workspace URL: https://your-organization.timehub.7pace.com",
            )
        };
        let text = text.trim();
        // Validate the text as written (RFC 3986, like URLComponents), not a repaired parse.
        let parts = UriParts::parse(text).ok_or_else(invalid)?;
        let host = parts.host_decoded().map(|host| host.to_lowercase());
        let port_ok = match parts.port {
            None | Some("") => true,
            Some(digits) => digits.parse::<u64>() == Ok(443),
        };
        let valid = parts.scheme == Some("https")
            && host.is_some_and(|host| host.ends_with(SEVEN_PACE_HOST_SUFFIX))
            && parts.user_info.is_none()
            && parts.query.is_none()
            && parts.fragment.is_none()
            && port_ok
            && matches!(parts.path, "" | "/");
        if !valid {
            return Err(invalid());
        }
        let url = Url::parse(text).map_err(|_| invalid())?;
        // The same rules on the parsed form, so nothing the parser normalised can slip through.
        let parsed_ok = url.scheme() == "https"
            && url.host_str().is_some_and(|host| host.ends_with(SEVEN_PACE_HOST_SUFFIX))
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.port().is_none()
            && url.path() == "/";
        if parsed_ok { Ok(url) } else { Err(invalid()) }
    }

    /// `https://dev.azure.com/<organization>` for an organization name matching
    /// `^[A-Za-z0-9][A-Za-z0-9_-]*$` after trimming.
    pub fn azure(organization: &str) -> Result<Url> {
        let invalid = || {
            AppError::message("Enter the organization name from dev.azure.com/your-organization.")
        };
        let organization = organization.trim();
        let mut chars = organization.chars();
        let valid = chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if !valid {
            return Err(invalid());
        }
        Url::parse(&format!("https://dev.azure.com/{organization}")).map_err(|_| invalid())
    }
}

//! Figma Desktop window observer over the Accessibility API, ported from `FigmaReader` and
//! `FigmaService` in `Sources/AzureTimetracker/FigmaService.swift` (1.14.x).
//!
//! `observe()` follows one Swift poll iteration:
//!
//! 1. `AXIsProcessTrusted()` false → [`WindowObservation::MissingAccess`].
//! 2. The frontmost app is not `com.figma.Desktop` → [`WindowObservation::NotForeground`]
//!    (Swift `.waiting`).
//! 3. Read the app element with a 0.12 s messaging timeout; set `AXManualAccessibility` once per
//!    pid (Electron only builds its tree on request); no focused window →
//!    [`WindowObservation::Waiting`] (Swift `.noAddress`).
//! 4. Take the focused window's title, then walk the window depth-first (at most 200 nodes and
//!    1.8 s, 0.12 s per element) reading `AXURL` then `AXDocument`. The walk stops at the first
//!    address that `FigmaDocument.parse` accepts (see [`figma_address_accepted`]) →
//!    `Window { title, url: Some(address) }`; none → `Window { title, url: None }` (Swift
//!    `.noAddress`).
//! 5. If the frontmost pid changed meanwhile the result is stale → `NotForeground`.
//!
//! Only AX error codes are logged, never titles or addresses. Reads are serialized, like the
//! Swift actor.

use std::ptr::{self, NonNull};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use objc2_application_services::{
    AXError, AXIsProcessTrusted, AXIsProcessTrustedWithOptions, AXUIElement,
    kAXTrustedCheckOptionPrompt,
};
use objc2_core_foundation::{
    CFArray, CFBoolean, CFDictionary, CFRetained, CFString, CFType, CFURL,
};
use objc2_foundation::NSString;

use crate::{FigmaObserver, WindowObservation};

const FIGMA_BUNDLE_ID: &str = "com.figma.Desktop";
const MESSAGING_TIMEOUT: f32 = 0.12;
const MAX_NODES: usize = 200;
const WALK_DEADLINE: Duration = Duration::from_millis(1800);

/// Accessibility-backed [`FigmaObserver`].
pub struct AxFigmaObserver {
    /// The pid that already received `AXManualAccessibility`; the lock serializes reads.
    enabled_pid: Mutex<Option<i32>>,
}

impl AxFigmaObserver {
    pub fn new() -> Self {
        Self { enabled_pid: Mutex::new(None) }
    }
}

impl Default for AxFigmaObserver {
    fn default() -> Self {
        Self::new()
    }
}

impl FigmaObserver for AxFigmaObserver {
    fn has_access(&self) -> bool {
        // SAFETY: no preconditions; never prompts.
        unsafe { AXIsProcessTrusted() }
    }

    fn request_access(&self) -> bool {
        // SAFETY: the options dictionary holds the documented key with a CFBoolean value. The
        // system shows its prompt asynchronously; the call returns the current state.
        unsafe {
            let options = CFDictionary::<CFString, CFType>::from_slices(
                &[kAXTrustedCheckOptionPrompt],
                &[CFBoolean::new(true).as_ref()],
            );
            AXIsProcessTrustedWithOptions(Some(&CFRetained::cast_unchecked(options)))
        }
    }

    fn observe(&self) -> WindowObservation {
        autoreleasepool(|_| {
            if !self.has_access() {
                return WindowObservation::MissingAccess;
            }
            let Some(pid) = frontmost_figma_pid() else {
                return WindowObservation::NotForeground;
            };
            let read = {
                let mut enabled_pid = self.enabled_pid.lock().unwrap_or_else(|p| p.into_inner());
                read_window(pid, &mut enabled_pid)
            };
            // Discard a stale result if focus changed while the AX tree was being read.
            if frontmost_pid() == Some(pid) { read } else { WindowObservation::NotForeground }
        })
    }

    fn figma_installed(&self) -> bool {
        autoreleasepool(|_| {
            NSWorkspace::sharedWorkspace()
                .URLForApplicationWithBundleIdentifier(&NSString::from_str(FIGMA_BUNDLE_ID))
                .is_some()
        })
    }
}

fn frontmost_pid() -> Option<i32> {
    NSWorkspace::sharedWorkspace().frontmostApplication().map(|app| app.processIdentifier())
}

fn frontmost_figma_pid() -> Option<i32> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let id = app.bundleIdentifier()?;
    (id.to_string() == FIGMA_BUNDLE_ID).then(|| app.processIdentifier())
}

/// `AXUIElementCopyAttributeValue`, `None` on any error.
fn attribute(element: &AXUIElement, name: &CFString) -> Option<CFRetained<CFType>> {
    let mut value: *const CFType = ptr::null();
    // SAFETY: valid element, attribute name and out-pointer; a success returns a +1 value.
    let result = unsafe { element.copy_attribute_value(name, NonNull::from(&mut value)) };
    let value = NonNull::new(value.cast_mut()).map(|value| unsafe { CFRetained::from_raw(value) });
    if result == AXError::Success { value } else { None }
}

/// Swift `(raw as? URL)?.absoluteString ?? (raw as? String)`.
fn address(value: &CFType) -> Option<String> {
    if let Some(url) = value.downcast_ref::<CFURL>() {
        return url.absolute_url().map(|absolute| absolute.string().to_string());
    }
    value.downcast_ref::<CFString>().map(|text| text.to_string())
}

fn read_window(pid: i32, enabled_pid: &mut Option<i32>) -> WindowObservation {
    // SAFETY: AXUIElementCreateApplication accepts any pid.
    let app = unsafe { AXUIElement::new_application(pid) };
    // SAFETY: valid element.
    unsafe { app.set_messaging_timeout(MESSAGING_TIMEOUT) };
    if *enabled_pid != Some(pid) {
        *enabled_pid = Some(pid);
        let name = CFString::from_static_str("AXManualAccessibility");
        // SAFETY: valid element, attribute and CFBoolean value.
        let result = unsafe { app.set_attribute_value(&name, CFBoolean::new(true).as_ref()) };
        if result != AXError::Success {
            tracing::info!(target: "att_platform::figma", code = result.0, "Figma accessibility tree request failed");
        }
    }
    let Some(window) = attribute(&app, &CFString::from_static_str("AXFocusedWindow"))
        .and_then(|value| value.downcast::<AXUIElement>().ok())
    else {
        return WindowObservation::Waiting;
    };
    let title = attribute(&window, &CFString::from_static_str("AXTitle"))
        .and_then(|value| value.downcast_ref::<CFString>().map(|text| text.to_string()));
    let names = [CFString::from_static_str("AXURL"), CFString::from_static_str("AXDocument")];
    let children_name = CFString::from_static_str("AXChildren");
    let url = walk(
        window,
        Instant::now() + WALK_DEADLINE,
        |element| {
            // SAFETY: valid element.
            unsafe { element.set_messaging_timeout(MESSAGING_TIMEOUT) };
            names.iter().find_map(|name| {
                attribute(element, name)
                    .as_deref()
                    .and_then(address)
                    .filter(|address| figma_address_accepted(address))
            })
        },
        |element, limit| {
            let Some(children) = attribute(element, &children_name)
                .and_then(|value| value.downcast::<CFArray>().ok())
            else {
                return Vec::new();
            };
            // SAFETY: AXChildren is an array of CFTypes (AXUIElements in practice).
            let children: CFRetained<CFArray<CFType>> =
                unsafe { CFRetained::cast_unchecked(children) };
            (0..children.len().min(limit))
                .filter_map(|index| children.get(index))
                .filter_map(|child| child.downcast::<AXUIElement>().ok())
                .collect()
        },
    );
    WindowObservation::Window { title, url }
}

/// The bounded depth-first walk of `FigmaReader.read`: pop the last element; stop once
/// [`MAX_NODES`] elements were visited or the deadline passed; return the element's accepted
/// address if any; otherwise push the first `MAX_NODES - visited` children in reverse so they
/// are visited in document order.
fn walk<N>(
    root: N,
    deadline: Instant,
    mut address: impl FnMut(&N) -> Option<String>,
    mut children: impl FnMut(&N, usize) -> Vec<N>,
) -> Option<String> {
    let mut stack = vec![root];
    let mut visited = 0;
    while let Some(element) = stack.pop() {
        if visited >= MAX_NODES || Instant::now() >= deadline {
            break;
        }
        visited += 1;
        if let Some(found) = address(&element) {
            return Some(found);
        }
        let mut batch = children(&element, MAX_NODES - visited);
        batch.reverse();
        stack.extend(batch);
    }
    None
}

/// Whether `FigmaDocument.parse(address)` (FigmaContext.swift) returns a document. The walk
/// must stop exactly where Swift stopped, and the engine re-parses the returned address with the
/// ported `FigmaDocument::parse` to build the document.
///
/// Mirrors `URLComponents(string:)` on macOS 14+: trims whitespace, prefixes `https://` for a bare
/// `figma.com/…`, requires scheme `https`, host `figma.com`/`www.figma.com` (percent-decoded,
/// case-insensitive), no user info, port absent or 443, and a percent-encoded path whose first
/// three non-empty segments are `design|file|board|slides`, an ASCII alphanumeric key, and a slug.
/// Query and fragment are ignored. Verified against Swift 6.4 on the vectors in the tests.
pub(crate) fn figma_address_accepted(address: &str) -> bool {
    let mut address = address.trim().to_string();
    if address.to_lowercase().starts_with("figma.com/") {
        address = format!("https://{address}");
    }
    let Some(rest) = address
        .get(..8)
        .filter(|scheme| scheme.eq_ignore_ascii_case("https://"))
        .map(|_| &address[8..])
    else {
        return false;
    };
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);
    if authority.contains('@') {
        // Any user info, even empty, makes `url.user` non-nil.
        return false;
    }
    let (host, port) = match authority.rfind(':') {
        Some(colon) if !authority.starts_with('[') => {
            (&authority[..colon], Some(&authority[colon + 1..]))
        }
        _ => (authority, None),
    };
    if let Some(port) = port
        && !port_accepted(port)
    {
        return false;
    }
    let Some(host) = percent_decode(host) else {
        return false;
    };
    let host = host.to_lowercase();
    if host != "figma.com" && host != "www.figma.com" {
        return false;
    }
    let path_end = tail.find(['?', '#']).unwrap_or(tail.len());
    let parts: Vec<&str> = tail[..path_end].split('/').filter(|part| !part.is_empty()).collect();
    parts.len() >= 3
        && ["design", "file", "board", "slides"].contains(&parts[0])
        && valid_key(parts[1])
}

/// `url.port == nil || url.port == 443`. An empty port is nil; digits that overflow are dropped
/// to nil by Foundation as well; anything else fails to parse.
fn port_accepted(port: &str) -> bool {
    if port.is_empty() {
        return true;
    }
    if !port.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    port.parse::<i64>().map_or(true, |value| value == 443)
}

/// `FigmaDocument.validKey`: non-empty ASCII letters and digits.
fn valid_key(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// Percent-decodes a host; `None` on a malformed escape or invalid UTF-8.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `(address, FigmaDocument.parse(address) != nil)` printed by Swift 6.4 on macOS 27.
    const SWIFT_PARSE: &[(&str, bool)] = &[
        ("https://www.figma.com/design/AbC123/My-File?node-id=1-2", true),
        ("https://figma.com/file/KEY/x", true),
        ("  https://www.figma.com/board/KEY/x \n", true),
        ("figma.com/design/KEY/Name", true),
        ("FIGMA.com/design/KEY/Name", true),
        ("www.figma.com/design/KEY/Name", false),
        ("HTTPS://WWW.FIGMA.COM/design/KEY/Name", true),
        ("https://www.figma.com/Design/KEY/Name", false),
        ("https://www.figma.com/slides/KEY/Name", true),
        ("https://www.figma.com/proto/KEY/Name", false),
        ("https://www.figma.com/design/KEY", false),
        ("https://www.figma.com/design/KEY/", false),
        ("https://www.figma.com//design//KEY//Name", true),
        ("https://www.figma.com/design/K-EY/Name", false),
        ("https://www.figma.com/design/K\u{c9}Y/Name", false),
        ("https://www.figma.com:443/design/KEY/Name", true),
        ("https://www.figma.com:8443/design/KEY/Name", false),
        ("https://www.figma.com:/design/KEY/Name", true),
        ("https://user@www.figma.com/design/KEY/Name", false),
        ("https://:pw@www.figma.com/design/KEY/Name", false),
        ("https://@www.figma.com/design/KEY/Name", false),
        ("http://www.figma.com/design/KEY/Name", false),
        ("https://evil.com/design/KEY/Name", false),
        ("https://www.figma.com.evil.com/design/KEY/Name", false),
        ("https://www%2Efigma.com/design/KEY/Name", true),
        ("https://www.figma.com/design/KEY/My File", true),
        ("https://www.figma.com/design/KEY/Caf%C3%A9", true),
        ("https://www.figma.com/design/KEY/Caf\u{e9}", true),
        ("https://www.figma.com/design/KEY/Name#frag", true),
        ("https://www.figma.com/design/KEY/Name?x=<y>", true),
        ("https://www.figma.com/design/KEY/Na%zzme", true),
        ("https://www.figma.com/design/KEY/Name|x", true),
        ("https://www.figma.com/design/KEY/Name\\x", true),
        ("https://www.figma.com/design/KEY/Name^x", true),
        ("https://www.figma.com/design/KEY/Name`x", true),
        ("https://www.figma.com/design/KEY/Name{x}", true),
        ("https://www.figma.com/design/KEY/Name\"x", true),
        ("https://www.figma.com/design/KEY/Name[x]", true),
        ("https://[::1]/design/KEY/Name", false),
        ("https:www.figma.com/design/KEY/Name", false),
        ("https:/www.figma.com/design/KEY/Name", false),
        ("https:///design/KEY/Name", false),
        ("about:blank", false),
        ("", false),
        ("file:///Users/x/Name.fig", false),
        ("https://www.figma.com/design/%4BEY/Name", false),
        ("https://www.figma.com/%64esign/KEY/Name", false),
        ("https://www.figma.com/design/KEY/Name/extra", true),
        ("https://www.figma.com./design/KEY/Name", false),
        ("https://www.figma.com/design/KEY/Name?", true),
        ("https://WWW.Figma.Com/file/KEY/Name", true),
        ("\u{a0}https://www.figma.com/design/KEY/Name\u{2028}", true),
        ("https://www.figma.com/design/KEY/Name%", true),
        ("https://www.figma.com/design/KEY/Name\u{7f}", true),
        ("https://www.figma.com/design/KEY/Name\t", true),
        ("https://www.figma.com:0443/design/KEY/Name", true),
        ("https://www.figma.com:abc/design/KEY/Name", false),
        ("https://www.figma.com:99999999999999999999/design/KEY/Name", true),
        ("https ://www.figma.com/design/KEY/Name", false),
        ("1https://www.figma.com/design/KEY/Name", false),
        ("h+t.t-p://www.figma.com/design/KEY/Name", false),
        ("https://www.fig ma.com/design/KEY/Name", false),
        ("https://www.figma.com/design/KEY/Name?q=a b", true),
        ("https://www.figma.com/design/KEY/Name#a#b", true),
        ("https://www.figma.com/design/KEY/Name?a?b", true),
        ("https://www.figma.com/design/KEY/N%41me", true),
        ("https://www.figma.com/design/KEY/Name?a=%zz", true),
        ("https://www.figma.com/design/KEY/Name#%zz", true),
        ("https://ww%zzw.figma.com/design/KEY/Name", false),
        ("https://www.figma.com/design/KEY/@Name", true),
        ("https://www.figma.com/design/KEY/Name:x", true),
        ("https://www.figma.com/design/KEY/;Name", true),
        ("https://www.figma.com/design/KEY/N%2Fme", true),
        ("https://www.figma.com/design/KEY/%2F", true),
        ("https://www.figma.com/design/KEY/%20", true),
        ("https://www.figma.com?x/design/KEY/Name", false),
        ("https://www.figma.com#/design/KEY/Name", false),
        ("https://www.figma.com:443:443/design/KEY/Name", false),
        ("https://u:p:q@www.figma.com/design/KEY/Name", false),
        ("https://a@b@www.figma.com/design/KEY/Name", false),
        ("https://www.figma.com/design/KEY/Name\u{0}", true),
        ("https://www.figma.com/design/KEY/Name\r\nx", true),
        ("https://xn--figma.com/design/KEY/Name", false),
        ("https://WWW.FIGMA.COM:443/FILE/KEY/Name", false),
        ("https://figma.com/file/KEY/x?y#z", true),
        ("https://www.figma.com/design/KEY/Name?q=%E2%9C%93", true),
        ("https://www.figma.com:70000/design/KEY/Name", false),
        ("https://www.figma.com:65535/design/KEY/Name", false),
        ("https://www.figma.com:9223372036854775807/design/KEY/Name", false),
        ("https://www.figma.com:9223372036854775808/design/KEY/Name", true),
        ("https://www.figma.com:+443/design/KEY/Name", false),
        ("https://www.figma.com:443 /design/KEY/Name", false),
        ("https://www.figma.com:-443/design/KEY/Name", false),
        ("Figma.Com/design/KEY/x", true),
        ("https://www.figma.com\t/design/KEY/Name", false),
        ("https://www.%46igma.com/design/KEY/Name", true),
        ("https://www.figma.com%3A443/design/KEY/Name", false),
        ("https://www.figma.com/design/KEY/x\u{85}", true),
        ("https://figma.com/file/KEY/x/", true),
    ];

    #[test]
    fn address_acceptance_matches_swift_figma_document_parse() {
        for (address, expected) in SWIFT_PARSE {
            assert_eq!(figma_address_accepted(address), *expected, "address {address:?}");
        }
    }

    #[test]
    fn has_access_reads_without_prompting() {
        // `AXIsProcessTrusted` only reads the TCC state; `request_access` is never called here.
        let observer = AxFigmaObserver::new();
        let _ = observer.has_access();
        let _ = observer.figma_installed();
    }

    #[derive(Clone)]
    struct Node {
        id: usize,
        address: Option<&'static str>,
        children: Vec<Node>,
    }

    fn leaf(id: usize, address: Option<&'static str>) -> Node {
        Node { id, address, children: Vec::new() }
    }

    /// Runs the walk and records the visit order and the child limits it asked for.
    fn run(root: Node, deadline: Instant) -> (Option<String>, Vec<usize>, Vec<usize>) {
        let mut visited = Vec::new();
        let mut limits = Vec::new();
        let found = walk(
            root,
            deadline,
            |node| {
                visited.push(node.id);
                node.address.map(String::from)
            },
            |node, limit| {
                limits.push(limit);
                node.children.iter().take(limit).cloned().collect()
            },
        );
        (found, visited, limits)
    }

    fn later() -> Instant {
        Instant::now() + Duration::from_secs(60)
    }

    #[test]
    fn walk_is_depth_first_in_document_order_and_stops_at_the_first_address() {
        let tree = Node {
            id: 0,
            address: None,
            children: vec![
                Node { id: 1, address: None, children: vec![leaf(3, None), leaf(4, Some("a"))] },
                leaf(2, Some("b")),
            ],
        };
        let (found, visited, _) = run(tree.clone(), later());
        assert_eq!(found.as_deref(), Some("a"));
        assert_eq!(visited, [0, 1, 3, 4]);

        let mut no_address = tree;
        no_address.children[0].children[1].address = None;
        no_address.children[1].address = None;
        let (found, visited, _) = run(no_address, later());
        assert_eq!(found, None);
        assert_eq!(visited, [0, 1, 3, 4, 2]);
    }

    #[test]
    fn walk_visits_at_most_200_nodes() {
        let wide =
            Node { id: 0, address: None, children: (1..=500).map(|id| leaf(id, None)).collect() };
        let (found, visited, limits) = run(wide, later());
        assert_eq!(found, None);
        assert_eq!(visited.len(), MAX_NODES);
        assert_eq!(limits[0], MAX_NODES - 1, "children are cut to the remaining budget");
        assert_eq!(visited[..3], [0, 1, 2]);

        let mut deep = leaf(300, Some("too deep"));
        for id in (0..300).rev() {
            deep = Node { id, address: None, children: vec![deep] };
        }
        let (found, visited, _) = run(deep, later());
        assert_eq!(found, None, "node 300 is beyond the budget");
        assert_eq!(visited.len(), MAX_NODES);
    }

    #[test]
    fn walk_respects_the_deadline() {
        let (found, visited, _) = run(leaf(0, Some("a")), Instant::now());
        assert_eq!((found, visited.len()), (None, 0), "an expired deadline visits nothing");
    }
}

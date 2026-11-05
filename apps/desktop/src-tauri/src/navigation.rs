//! Keeps every web view on the app's own pages. A link to another site that reaches the web view
//! anyway (a plain `<a href>`, the context menu's "Open Link", a middle click, a dragged link)
//! would otherwise replace the app with that page, with no way back. Such navigations are
//! cancelled and the https (or figma) URL is opened in the default browser or app instead; any
//! other scheme is only cancelled.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};
use tauri_plugin_opener::OpenerExt;

/// What happens to a navigation the web view is about to start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Navigation {
    /// The app's own pages: the bundled frontend, the dev server, in-page documents.
    Allow,
    /// Another site: cancelled, then opened in the default browser (or Figma).
    OpenExternally,
    /// Cancelled and nothing opened (`file:`, `javascript:`, plain `http:` to another host…).
    Block,
}

/// Hosts that serve the app itself: `tauri://localhost` (macOS), `http(s)://tauri.localhost`
/// (Windows) and the dev server (`devUrl`, `http://localhost:1420`).
fn is_app_host(url: &Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "tauri.localhost" | "127.0.0.1" | "[::1]"))
}

pub fn decide(url: &Url) -> Navigation {
    match url.scheme() {
        "tauri" | "asset" | "ipc" | "about" | "data" | "blob" => Navigation::Allow,
        "http" | "https" if is_app_host(url) => Navigation::Allow,
        "https" | "figma" => Navigation::OpenExternally,
        _ => Navigation::Block,
    }
}

/// The guard, as a plugin so it covers every web view, including the ones from `tauri.conf.json`.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| match decide(url) {
            Navigation::Allow => true,
            Navigation::OpenExternally => {
                if let Err(error) = webview.opener().open_url(url.as_str(), None::<&str>) {
                    tracing::warn!(%error, "could not open a link in the browser");
                }
                false
            }
            Navigation::Block => {
                tracing::warn!(scheme = url.scheme(), "blocked a navigation away from the app");
                false
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decide_str(url: &str) -> Navigation {
        decide(&Url::parse(url).expect("url"))
    }

    #[test]
    fn the_app_and_dev_server_stay_in_the_window() {
        for url in [
            "tauri://localhost/index.html",
            "tauri://localhost/index.html#settings/azure",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/index.html",
            "http://localhost:1420/",
            "http://127.0.0.1:1420/?surface=panel",
            "about:blank",
        ] {
            assert_eq!(decide_str(url), Navigation::Allow, "{url}");
        }
    }

    #[test]
    fn other_sites_open_in_the_browser() {
        for url in [
            "https://diekeure-webdev.timehub.7pace.com",
            "https://diekeure-webdev.timehub.7pace.com/",
            "https://dev.azure.com/diekeure-webdev/LK2020/_workitems/edit/33624",
            "https://github.com/DerpRL/die-keure-azure-timetracker/releases/latest",
            "figma://file/abc",
            // Not the app: only the exact app hosts count.
            "https://localhost.example.com/",
        ] {
            assert_eq!(decide_str(url), Navigation::OpenExternally, "{url}");
        }
    }

    #[test]
    fn anything_else_is_cancelled() {
        for url in [
            "http://diekeure-webdev.timehub.7pace.com",
            "file:///etc/hosts",
            "javascript:alert(1)",
            "mailto:someone@example.com",
        ] {
            assert_eq!(decide_str(url), Navigation::Block, "{url}");
        }
    }
}

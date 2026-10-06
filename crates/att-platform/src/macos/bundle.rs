//! Application bundle identity: the enclosing `.app` of an executable path and the identifier and
//! display name from a bundle's Info.plist, read through `NSBundle` exactly as the Swift app did
//! (`Bundle(path:)`, `bundleIdentifier`, `object(forInfoDictionaryKey:)`, which also returns
//! InfoPlist.strings localisations).

use std::path::Path;

use objc2::rc::autoreleasepool;
use objc2_foundation::{NSBundle, NSString};

/// What `Bundle(path:)` exposes about an application bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BundleInfo {
    /// `CFBundleIdentifier`, `None` when the bundle has none.
    pub id: Option<String>,
    /// `CFBundleDisplayName`, then `CFBundleName`, then the bundle's file name without extension.
    pub name: String,
    /// `bundle.bundlePath`.
    pub path: String,
}

/// Reads the bundle at `path`. `None` when the path is not an accessible bundle directory.
pub(crate) fn read_bundle(path: &str) -> Option<BundleInfo> {
    autoreleasepool(|_| {
        let bundle = NSBundle::bundleWithPath(&NSString::from_str(path))?;
        let bundle_path = bundle.bundlePath().to_string();
        let name = info_string(&bundle, "CFBundleDisplayName")
            .or_else(|| info_string(&bundle, "CFBundleName"))
            .unwrap_or_else(|| file_stem(&bundle_path));
        Some(BundleInfo {
            id: bundle.bundleIdentifier().map(|id| id.to_string()),
            name,
            path: bundle_path,
        })
    })
}

/// Swift `bundle.object(forInfoDictionaryKey:) as? String`.
fn info_string(bundle: &NSBundle, key: &str) -> Option<String> {
    let value = bundle.objectForInfoDictionaryKey(&NSString::from_str(key))?;
    value.downcast_ref::<NSString>().map(|text| text.to_string())
}

/// Swift `URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent`.
pub(crate) fn file_stem(path: &str) -> String {
    let path = Path::new(path);
    path.file_stem()
        .or_else(|| path.file_name())
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// The outermost `.app` bundle that contains `path`, as `MicrophoneReader.owner` computes it:
/// `URL(fileURLWithPath:).pathComponents`, the first component ending in `.app` (case-sensitive),
/// then `NSString.path(withComponents:)`. `.` and `..` are kept, as Foundation keeps them.
pub(crate) fn enclosing_app(path: &str) -> Option<String> {
    if path.is_empty() {
        // Swift resolves "" to the working directory, which is `/` for an app launched by
        // launchd, so it never contains an `.app` component.
        return None;
    }
    let absolute = if path.starts_with('/') {
        path.to_string()
    } else {
        // `fileURLWithPath:` resolves relative paths against the working directory.
        let cwd = std::env::current_dir().ok()?;
        format!("{}/{path}", cwd.to_string_lossy())
    };
    let components: Vec<&str> = absolute.split('/').filter(|part| !part.is_empty()).collect();
    let index = components.iter().position(|part| part.ends_with(".app"))?;
    Some(format!("/{}", components[..=index].join("/")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macos::test_support::{TempDir, standardized};

    #[test]
    fn enclosing_app_matches_foundation_path_components() {
        // Expected values printed by Swift 6.4 (`URL.pathComponents` + `NSString.path(withComponents:)`).
        let cases = [
            (
                "/Applications/Microsoft Teams.app/Contents/MacOS/MSTeams",
                Some("/Applications/Microsoft Teams.app"),
            ),
            (
                "/Applications/Slack.app/Contents/Frameworks/Slack Helper.app/Contents/MacOS/Slack Helper",
                Some("/Applications/Slack.app"),
            ),
            (
                "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU",
                None,
            ),
            ("/usr/bin/say", None),
            ("/Applications/.app/x", Some("/Applications/.app")),
            ("/Applications/Foo.APP/Contents/MacOS/Foo", None),
            ("/Applications//Foo.app//Contents/", Some("/Applications/Foo.app")),
            ("/Foo.app", Some("/Foo.app")),
            ("/a/b.app.bak/c.app/d", Some("/a/b.app.bak/c.app")),
            ("/a/./b.app/../c.app/d", Some("/a/./b.app")),
            ("/Users/x/My App.app/Contents/MacOS/My App", Some("/Users/x/My App.app")),
            ("/", None),
            ("/Applications/Foo.app/", Some("/Applications/Foo.app")),
            ("/a/b/../Foo.app/x", Some("/a/b/../Foo.app")),
            ("//Applications/Foo.app/x", Some("/Applications/Foo.app")),
            ("/a/b/./c.app", Some("/a/b/./c.app")),
            ("", None),
        ];
        for (path, expected) in cases {
            assert_eq!(enclosing_app(path).as_deref(), expected, "path {path:?}");
        }
    }

    #[test]
    fn relative_paths_resolve_against_the_working_directory() {
        let cwd = std::env::current_dir().expect("cwd");
        let expected = format!("{}/relative/Foo.app", cwd.to_string_lossy());
        assert_eq!(
            enclosing_app("relative/Foo.app/Contents/MacOS/Foo").as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn file_stem_drops_only_the_last_extension() {
        assert_eq!(file_stem("/Applications/Microsoft Teams.app"), "Microsoft Teams");
        assert_eq!(file_stem("/Applications/Foo.bar.app"), "Foo.bar");
        assert_eq!(file_stem("/Applications/.app"), ".app");
        assert_eq!(file_stem("/Applications/Plain"), "Plain");
    }

    #[test]
    fn reads_identifier_and_name_fallbacks_from_info_plist() {
        let dir = TempDir::new("bundle");
        let full = dir.fake_app(
            "Full.app",
            &[
                ("CFBundleIdentifier", "be.example.full"),
                ("CFBundleDisplayName", "Full Display"),
                ("CFBundleName", "Full Name"),
            ],
        );
        let named = dir.fake_app(
            "Named.app",
            &[("CFBundleIdentifier", "be.example.named"), ("CFBundleName", "Named Bundle")],
        );
        let bare = dir.fake_app("Bare Tool.app", &[("CFBundleIdentifier", "be.example.bare")]);
        let anonymous = dir.fake_app("Anonymous.app", &[("CFBundleName", "Anonymous")]);

        let info = read_bundle(&full).expect("full bundle");
        assert_eq!(info.id.as_deref(), Some("be.example.full"));
        assert_eq!(info.name, "Full Display");
        assert_eq!(info.path, standardized(&full), "bundlePath is Foundation-standardized");

        let info = read_bundle(&named).expect("named bundle");
        assert_eq!(
            (info.id.as_deref(), info.name.as_str()),
            (Some("be.example.named"), "Named Bundle")
        );

        let info = read_bundle(&bare).expect("bare bundle");
        assert_eq!(
            (info.id.as_deref(), info.name.as_str()),
            (Some("be.example.bare"), "Bare Tool")
        );

        let info = read_bundle(&anonymous).expect("bundle without identifier");
        assert_eq!(info.id, None);
        assert_eq!(info.name, "Anonymous");

        assert_eq!(read_bundle(&format!("{}/Missing.app", dir.path())), None);
    }
}

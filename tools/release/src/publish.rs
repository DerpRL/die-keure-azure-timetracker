//! `publish <version> --from <dir> --notes <file>`: uploads a verified release to GitHub Releases
//! with the `gh` CLI. The release is created as a draft (tag `v<version>` on the checked-out
//! commit, which must already be on GitHub), every asset is uploaded and compared by name and
//! size, and only then is the draft published and marked latest. Installed 2.x apps read
//! `releases/latest/download/latest.json`, so they see the new version at that moment, with all of
//! its assets already in place.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::consts::{GITHUB_BASE, PRODUCT_NAME, REPOSITORY, V2_FEED_URL, release_tag};
use crate::process::Cmd;
use crate::verify::{self, Artifacts, VerifyOptions};
use crate::{feed, fsx, log};

#[derive(Debug, Clone)]
pub struct PublishOptions {
    pub version: String,
    pub from: PathBuf,
    pub notes: PathBuf,
    pub repository: PathBuf,
    /// Stop after uploading the draft (review it on GitHub, then run again without `--draft`).
    pub draft: bool,
    pub verify: VerifyOptions,
}

/// The files that go on the release page, in upload order.
pub fn release_assets(artifacts: &Artifacts) -> Result<Vec<PathBuf>> {
    let dmg = artifacts.dmg.as_ref().context("no DMG in the artifact folder (package-macos)")?;
    let archive = artifacts
        .mac_archive
        .as_ref()
        .context("no macOS updater archive in the artifact folder (package-macos)")?;
    let installer = artifacts
        .windows_installer
        .as_ref()
        .context("no Windows installer in the artifact folder (build-windows)")?;
    let feed = artifacts.v2_feed.as_ref().context("no latest.json (att-release feed)")?;
    let mut assets = vec![dmg.clone(), fsx::with_suffix(dmg, ".sha256")];
    for update in [archive, installer] {
        assets.push(update.clone());
        assets.push(fsx::with_suffix(update, ".sha256"));
        assets.push(fsx::with_suffix(update, ".sig"));
    }
    assets.push(feed.clone());
    for asset in &assets {
        if !asset.is_file() {
            bail!("{} is missing", asset.display());
        }
    }
    Ok(assets)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseView {
    is_draft: bool,
    #[serde(default)]
    assets: Vec<AssetView>,
}

#[derive(Debug, Deserialize)]
struct AssetView {
    name: String,
    size: u64,
}

fn gh() -> Cmd {
    Cmd::new("gh")
}

fn view(tag: &str) -> Result<Option<ReleaseView>> {
    let output = gh()
        .args(["release", "view", tag, "--repo", REPOSITORY, "--json", "isDraft,assets"])
        .quiet()
        .output_any()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("release not found") || stderr.contains("Not Found") {
            return Ok(None);
        }
        bail!("gh release view {tag} failed: {}", stderr.trim());
    }
    Ok(Some(serde_json::from_slice(&output.stdout).context("unexpected gh release view output")?))
}

fn git(repository: &Path, args: &[&str]) -> Result<String> {
    Ok(Cmd::new("git").args(args).current_dir(repository).quiet().stdout_text()?.trim().to_owned())
}

/// The commit to tag: clean tracked files, and already on GitHub.
fn release_commit(repository: &Path) -> Result<String> {
    let commit = git(repository, &["rev-parse", "HEAD"])?;
    let dirty = git(repository, &["status", "--porcelain", "--untracked-files=no"])?;
    if !dirty.is_empty() {
        bail!(
            "the checkout has uncommitted changes; build, commit and push the release commit first:\n{dirty}"
        );
    }
    gh().args(["api", &format!("repos/{REPOSITORY}/commits/{commit}"), "--silent"])
        .quiet()
        .output()
        .with_context(|| format!("commit {commit} is not on GitHub yet; push it first"))?;
    Ok(commit)
}

fn check_uploaded(tag: &str, assets: &[PathBuf]) -> Result<()> {
    let release = view(tag)?.context("the draft release disappeared")?;
    let uploaded: BTreeMap<_, _> =
        release.assets.iter().map(|asset| (asset.name.as_str(), asset.size)).collect();
    for asset in assets {
        let name = fsx::file_name(asset)?;
        let size = fs::metadata(asset)?.len();
        match uploaded.get(name.as_str()) {
            Some(remote) if *remote == size => {}
            Some(remote) => bail!("{name} is {remote} bytes on GitHub, {size} locally"),
            None => bail!("{name} is missing from the release"),
        }
    }
    let expected: Vec<String> =
        assets.iter().map(|path| fsx::file_name(path)).collect::<Result<_>>()?;
    for name in uploaded.keys() {
        if !expected.iter().any(|local| local == name) {
            log::warn(format!("the release also has {name}, which this run did not upload"));
        }
    }
    log::ok(format!("{} assets uploaded with the right sizes", assets.len()));
    Ok(())
}

/// Fetches the public feed after publishing (GitHub may take a moment to switch `latest`).
fn check_public_feed(version: &str) {
    for attempt in 1..=6 {
        let fetched = Cmd::new("curl")
            .args(["-fsSL", "--max-time", "30", V2_FEED_URL])
            .quiet()
            .stdout_text()
            .and_then(|text| feed::parse(&text));
        match fetched {
            Ok(feed) if feed.version == version => {
                log::ok(format!("{V2_FEED_URL} offers {version}"));
                return;
            }
            Ok(feed) => {
                log::info(format!("the public feed still offers {} (try {attempt})", feed.version))
            }
            Err(error) => {
                log::info(format!("the public feed is not readable yet: {error:#} (try {attempt})"))
            }
        }
        std::thread::sleep(Duration::from_secs(10));
    }
    log::warn(format!(
        "{V2_FEED_URL} does not offer {version} yet; check it again in a few minutes"
    ));
}

pub fn publish(options: &PublishOptions) -> Result<()> {
    let tag = release_tag(&options.version);
    let mut verify_options = options.verify.clone();
    verify_options.expected_version = Some(options.version.clone());
    let artifacts = verify::verify_dir(&options.from, &verify_options)?;
    let assets = release_assets(&artifacts)?;
    let parsed = feed::parse(&fs::read_to_string(artifacts.v2_feed.as_ref().context("no feed")?)?)?;
    for target in feed::MAC_TARGETS.iter().chain([&feed::WINDOWS_TARGET]) {
        if !parsed.platforms.contains_key(*target) {
            bail!("latest.json has no {target}; always publish macOS and Windows together");
        }
    }
    let notes = fs::read_to_string(&options.notes)
        .with_context(|| format!("could not read {}", options.notes.display()))?;
    if notes.trim().is_empty() {
        bail!("{} is empty", options.notes.display());
    }

    log::step("Checking gh and the release commit");
    gh().args(["auth", "status", "--hostname", "github.com"])
        .quiet()
        .output()
        .context("gh is not installed or not signed in (brew install gh; gh auth login)")?;
    let commit = release_commit(&options.repository)?;
    log::ok(format!("tagging {commit} as {tag}"));

    let title = format!("{PRODUCT_NAME} {}", options.version);
    match view(&tag)? {
        Some(release) if !release.is_draft => bail!(
            "{tag} is already published at {GITHUB_BASE}/releases/tag/{tag}; published assets are permanent URLs, increment the version"
        ),
        Some(_) => {
            log::step(format!("Updating the existing draft {tag}"));
            gh().args(["release", "edit", &tag, "--repo", REPOSITORY, "--target", &commit])
                .args(["--title", &title, "--notes-file"])
                .arg(&options.notes)
                .run()?;
            gh().args(["release", "upload", &tag, "--repo", REPOSITORY, "--clobber"])
                .args(&assets)
                .run()?;
        }
        None => {
            log::step(format!("Creating the draft release {tag}"));
            gh().args(["release", "create", &tag, "--repo", REPOSITORY, "--draft"])
                .args(["--target", &commit, "--title", &title, "--notes-file"])
                .arg(&options.notes)
                .args(&assets)
                .run()?;
        }
    }
    check_uploaded(&tag, &assets)?;

    if options.draft {
        log::step(format!(
            "Draft {tag} is ready for review on {GITHUB_BASE}/releases. Run publish again without --draft to release it."
        ));
        return Ok(());
    }
    log::step(format!("Publishing {tag} as the latest release"));
    gh().args(["release", "edit", &tag, "--repo", REPOSITORY, "--draft=false", "--latest"])
        .run()?;
    check_public_feed(&options.version);
    log::step(format!("Published {GITHUB_BASE}/releases/tag/{tag}"));
    Ok(())
}

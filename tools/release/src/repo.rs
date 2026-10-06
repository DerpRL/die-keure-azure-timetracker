//! The repository this tool belongs to, and the Tauri shell configuration the release depends on.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde_json::Value;

use crate::bundle::AppVersion;
use crate::consts::{BUNDLE_ID, EXECUTABLE_NAME, PRODUCT_NAME, REPO_TAURI_CONF, V2_FEED_URL};
use crate::{log, updater_key};

/// `--repo`, else the workspace this crate was built from (`tools/release/../..`).
pub fn root(cli: Option<&Path>) -> Result<PathBuf> {
    let root = match cli {
        Some(path) => path.to_owned(),
        None => Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
    };
    let root = fs::canonicalize(&root)
        .with_context(|| format!("repository {} not found", root.display()))?;
    if !root.join("Cargo.toml").is_file() {
        bail!("{} is not the repository root (no Cargo.toml)", root.display());
    }
    Ok(root)
}

#[derive(Debug, Clone)]
pub struct TauriConf {
    pub path: PathBuf,
    pub value: Value,
}

impl TauriConf {
    pub fn load(repository: &Path) -> Result<Option<Self>> {
        let path = repository.join(REPO_TAURI_CONF);
        if !path.is_file() {
            return Ok(None);
        }
        let text = fs::read_to_string(&path)?;
        let value = serde_json::from_str(&text)
            .with_context(|| format!("{} is not valid JSON", path.display()))?;
        Ok(Some(Self { path, value }))
    }

    fn get(&self, pointer: &str) -> Option<&Value> {
        self.value.pointer(pointer)
    }

    fn text(&self, pointer: &str) -> Option<&str> {
        self.get(pointer).and_then(Value::as_str)
    }

    pub fn pubkey(&self) -> Option<&str> {
        self.text("/plugins/updater/pubkey")
    }

    pub fn version(&self) -> Option<&str> {
        self.text("/version")
    }

    /// Problems that make a release wrong (errors) or diverge from the documented setup (warnings).
    pub fn review(&self) -> (Vec<String>, Vec<String>) {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();
        let mut expect = |pointer: &str, expected: &str| {
            if self.text(pointer) != Some(expected) {
                errors.push(format!(
                    "{pointer} must be {expected:?} (found {:?})",
                    self.get(pointer)
                ));
            }
        };
        expect("/productName", PRODUCT_NAME);
        expect("/identifier", BUNDLE_ID);
        expect("/mainBinaryName", EXECUTABLE_NAME);
        match self.version() {
            Some(version) if AppVersion::parse(version).is_ok() => {}
            other => errors.push(format!(
                "/version must be a plain major.minor.patch version (found {other:?})"
            )),
        }
        match self.text("/bundle/macOS/bundleVersion") {
            Some(build) if !build.is_empty() && build.bytes().all(|b| b.is_ascii_digit()) && !build.starts_with('0') => {}
            other => errors.push(format!(
                "/bundle/macOS/bundleVersion must be an integer build number such as \"25\" for the 1.x validator (found {other:?})"
            )),
        }
        match self.get("/bundle/createUpdaterArtifacts") {
            None | Some(Value::Bool(false)) => {}
            Some(other) => errors.push(format!(
                "/bundle/createUpdaterArtifacts must be false: the release tool builds and signs the updater archives after codesigning (found {other})"
            )),
        }
        match self.get("/bundle/macOS/signingIdentity") {
            None | Some(Value::Null) => {}
            Some(other) => errors.push(format!(
                "/bundle/macOS/signingIdentity must be null: the release tool signs with the local certificate (found {other})"
            )),
        }
        let endpoints = self.get("/plugins/updater/endpoints").and_then(Value::as_array);
        if endpoints.map(|list| list.iter().filter_map(Value::as_str).collect::<Vec<_>>())
            != Some(vec![V2_FEED_URL])
        {
            errors.push(format!("/plugins/updater/endpoints must be [{V2_FEED_URL:?}]"));
        }
        match self.pubkey() {
            Some(key) if updater_key::public_key_id(key).is_ok() => {}
            _ => errors.push(
                "/plugins/updater/pubkey is not a valid updater public key (still the placeholder?); run `att-release keygen-v2`".to_owned(),
            ),
        }
        if self.text("/bundle/macOS/minimumSystemVersion") != Some("14.0") {
            warnings.push(format!(
                "/bundle/macOS/minimumSystemVersion is {:?}; 1.14.x used \"14.0\"",
                self.get("/bundle/macOS/minimumSystemVersion")
            ));
        }
        if self.get("/plugins/updater/requireSignedVersion") != Some(&Value::Bool(true)) {
            warnings.push(
                "/plugins/updater/requireSignedVersion is not true; release signatures carry the version, so enabling it blocks downgrade replays".to_owned(),
            );
        }
        if let Some(mode) = self.text("/bundle/windows/nsis/installMode")
            && mode != "currentUser"
        {
            warnings.push(format!("/bundle/windows/nsis/installMode is {mode:?}; per-user (\"currentUser\") installs update without admin rights"));
        }
        if self
            .get("/bundle/macOS/frameworks")
            .and_then(Value::as_array)
            .is_some_and(|list| !list.is_empty())
        {
            warnings.push("/bundle/macOS/frameworks is not empty: framework symlinks are refused by the 1.x bridge validator".to_owned());
        }
        (errors, warnings)
    }

    /// Prints the review; fails when there are errors.
    pub fn require_release_ready(&self) -> Result<()> {
        let (errors, warnings) = self.review();
        for warning in &warnings {
            log::warn(warning);
        }
        if !errors.is_empty() {
            bail!("{} is not ready for a release:\n  {}", self.path.display(), errors.join("\n  "));
        }
        log::ok(format!("{} matches the release requirements", self.path.display()));
        Ok(())
    }
}

/// The updater public key to check signatures against: `--pubkey` (key text or a file holding
/// it), else `plugins.updater.pubkey` from `tauri.conf.json`, which is what the shipped app trusts.
pub fn resolve_pubkey(cli: Option<&str>, repository: &Path) -> Result<(String, String)> {
    let (key, source) = match cli {
        Some(value) if Path::new(value).is_file() => {
            (fs::read_to_string(value)?.trim().to_owned(), value.to_owned())
        }
        Some(value) => (value.trim().to_owned(), "--pubkey".to_owned()),
        None => {
            let conf = TauriConf::load(repository)?
                .with_context(|| format!("{REPO_TAURI_CONF} not found; pass --pubkey"))?;
            let key = conf
                .pubkey()
                .with_context(|| format!("{REPO_TAURI_CONF} has no plugins.updater.pubkey"))?;
            (key.to_owned(), conf.path.display().to_string())
        }
    };
    let id = updater_key::public_key_id(&key)
        .with_context(|| format!("the updater public key from {source} is not valid"))?;
    Ok((key, format!("{source} (key id {id})")))
}

//! The 2.x updater key pair and signatures, byte-compatible with the Tauri CLI 2.12
//! (`tauri signer generate/sign`: minisign 0.9, files holding base64 of the minisign text boxes)
//! and checked the way `tauri-plugin-updater` 2.13 checks them (minisign-verify 0.2, then the
//! `version:` field of the trusted comment).

use std::fs::{self, OpenOptions};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use minisign::{KeyPair, PublicKey, SecretKey, SecretKeyBox};

use crate::{fsx, log};

pub const SIGNATURE_COMMENT: &str = "signature from tauri secret key";

#[derive(Debug, Clone)]
pub enum KeySource {
    File(PathBuf),
    /// The key text itself, as `TAURI_SIGNING_PRIVATE_KEY` may carry it.
    Inline(String),
}

impl KeySource {
    pub fn describe(&self) -> String {
        match self {
            KeySource::File(path) => path.display().to_string(),
            KeySource::Inline(_) => "TAURI_SIGNING_PRIVATE_KEY (inline key)".to_owned(),
        }
    }
}

/// `--key`, else `TAURI_SIGNING_PRIVATE_KEY` (a path or the key text, like the Tauri CLI).
pub fn resolve_key_source(cli: Option<&Path>) -> Result<KeySource> {
    if let Some(path) = cli {
        return Ok(KeySource::File(path.to_owned()));
    }
    match std::env::var("TAURI_SIGNING_PRIVATE_KEY") {
        Ok(value) if !value.trim().is_empty() => {
            let value = value.trim();
            let path = PathBuf::from(value);
            Ok(if path.is_file() {
                KeySource::File(path)
            } else {
                KeySource::Inline(value.to_owned())
            })
        }
        _ => bail!(
            "no updater key: pass --key \"$HOME/Library/Application Support/Azure timetracker Releases/updater-v2.key\" \
             or set TAURI_SIGNING_PRIVATE_KEY"
        ),
    }
}

/// `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, empty when unset (the key is generated without one).
pub fn password_from_env() -> String {
    std::env::var("TAURI_SIGNING_PRIVATE_KEY_PASSWORD").unwrap_or_default()
}

fn decode_text(base64_text: &str, what: &str) -> Result<String> {
    let bytes =
        STANDARD.decode(base64_text.trim()).with_context(|| format!("{what} is not base64"))?;
    String::from_utf8(bytes).with_context(|| format!("{what} is not UTF-8"))
}

fn public_box_b64(public: &PublicKey) -> Result<String> {
    Ok(STANDARD.encode(public.to_box().context("could not encode the public key")?.to_string()))
}

/// A decrypted signing key and its public key in `tauri.conf.json` format.
pub struct UpdaterKey {
    secret: SecretKey,
    public: PublicKey,
    pub public_b64: String,
}

impl UpdaterKey {
    pub fn key_id(&self) -> String {
        key_id_hex(self.public.keynum())
    }
}

fn key_id_hex(keynum: &[u8]) -> String {
    keynum.iter().rev().map(|byte| format!("{byte:02X}")).collect()
}

fn decrypt(text: &str, password: &str) -> Result<SecretKey> {
    let decoded = decode_text(text, "the updater private key")?;
    let secret_box = SecretKeyBox::from_string(&decoded).context("not a minisign secret key")?;
    match secret_box.clone().into_secret_key(Some(password.to_owned())) {
        Ok(secret) => Ok(secret),
        Err(error) if error.to_string().contains("not encrypted") => secret_box
            .into_unencrypted_secret_key()
            .context("could not read the unencrypted updater key"),
        Err(error) => Err(anyhow::anyhow!(
            "could not decrypt the updater key ({error}); set TAURI_SIGNING_PRIVATE_KEY_PASSWORD if it has a password"
        )),
    }
}

/// Loads a key file (outside any repository, mode 600) or inline key text.
pub fn load(source: &KeySource, password: &str, repository: Option<&Path>) -> Result<UpdaterKey> {
    let text = match source {
        KeySource::File(path) => {
            fsx::refuse_inside_repository(path, repository, "The updater private key")?;
            fsx::check_private_file(path)?;
            fs::read_to_string(path)
                .with_context(|| format!("could not read {}", path.display()))?
        }
        KeySource::Inline(text) => text.clone(),
    };
    let secret = decrypt(&text, password)?;
    let public = PublicKey::from_secret_key(&secret).context("could not derive the public key")?;
    let public_b64 = public_box_b64(&public)?;
    Ok(UpdaterKey { secret, public, public_b64 })
}

pub fn public_path(secret_path: &Path) -> PathBuf {
    fsx::with_suffix(secret_path, ".pub")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeygenOutcome {
    Created,
    AlreadyPresent,
    /// The private key existed and its `.pub` file was missing; it was written again.
    PublicFileRestored,
}

/// Creates the key pair at `secret_path` + `.pub` unless it exists (idempotent). Returns the
/// public key in `tauri.conf.json` format.
pub fn keygen(
    secret_path: &Path,
    password: &str,
    repository: Option<&Path>,
) -> Result<(KeygenOutcome, String)> {
    fsx::refuse_inside_repository(secret_path, repository, "The updater private key")?;
    let public_file = public_path(secret_path);
    if let Some(parent) = secret_path.parent() {
        fsx::ensure_private_dir(parent)?;
    }
    if secret_path.exists() {
        let key = load(&KeySource::File(secret_path.to_owned()), password, repository)?;
        if public_file.exists() {
            let stored = fs::read_to_string(&public_file)?;
            if stored.trim() != key.public_b64 {
                bail!(
                    "{} does not belong to {}; restore the matching files from your backup",
                    public_file.display(),
                    secret_path.display()
                );
            }
            return Ok((KeygenOutcome::AlreadyPresent, key.public_b64));
        }
        fs::write(&public_file, &key.public_b64)?;
        return Ok((KeygenOutcome::PublicFileRestored, key.public_b64));
    }
    if public_file.exists() {
        bail!(
            "{} exists without its private key {}; restore the private key from your backup \
             instead of generating a replacement (a new key cannot sign updates for installed apps)",
            public_file.display(),
            secret_path.display()
        );
    }
    log::info("deriving the key encryption key (scrypt); this takes a few seconds");
    let KeyPair { pk, sk } = KeyPair::generate_encrypted_keypair(Some(password.to_owned()))
        .context("could not generate the key pair")?;
    let secret_text =
        STANDARD.encode(sk.to_box(None).context("could not encode the secret key")?.to_string());
    let public_text = public_box_b64(&pk)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(secret_path)
        .with_context(|| format!("could not create {}", secret_path.display()))?;
    file.write_all(secret_text.as_bytes())?;
    file.sync_all()?;
    fs::write(&public_file, &public_text)?;
    // Read back what was written before reporting success.
    let check = load(&KeySource::File(secret_path.to_owned()), password, repository)?;
    if check.public_b64 != public_text {
        bail!("the written key pair does not round-trip");
    }
    Ok((KeygenOutcome::Created, public_text))
}

fn unix_timestamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_secs()).unwrap_or(0)
}

/// The Tauri CLI's trusted comment: `timestamp:<unix>\tfile:<name>\tversion:<version>`.
pub fn trusted_comment(file_name: &str, version: &str) -> Result<String> {
    if file_name.contains(['\t', '\r', '\n']) || version.contains(['\t', '\r', '\n']) {
        bail!("file names and versions in signatures cannot contain tabs or newlines");
    }
    Ok(format!("timestamp:{}\tfile:{file_name}\tversion:{version}", unix_timestamp()))
}

/// Signs `data` and returns the `.sig` file content (base64 of the minisign signature box).
pub fn sign_bytes(key: &UpdaterKey, data: &[u8], file_name: &str, version: &str) -> Result<String> {
    let comment = trusted_comment(file_name, version)?;
    let signature = minisign::sign(
        Some(&key.public),
        &key.secret,
        Cursor::new(data),
        Some(&comment),
        Some(SIGNATURE_COMMENT),
    )
    .context("could not sign")?;
    let encoded = STANDARD.encode(signature.to_string());
    verify(data, &encoded, &key.public_b64, Some(version))?;
    Ok(encoded)
}

/// Signs a file and writes `<file>.sig`. Returns the signature text.
pub fn sign_file(key: &UpdaterKey, path: &Path, version: &str) -> Result<String> {
    let data = fs::read(path).with_context(|| format!("could not read {}", path.display()))?;
    let signature = sign_bytes(key, &data, &fsx::file_name(path)?, version)?;
    fsx::write_atomic(&fsx::with_suffix(path, ".sig"), signature.as_bytes())?;
    Ok(signature)
}

/// Checks a `.sig` text against `data` and a `tauri.conf.json` public key, as the updater plugin
/// does. With `expected_version`, the signed `version:` must be present and equal (the plugin's
/// `requireSignedVersion`). Returns the trusted comment.
pub fn verify(
    data: &[u8],
    signature_b64: &str,
    public_b64: &str,
    expected_version: Option<&str>,
) -> Result<String> {
    let public_text = decode_text(public_b64, "the updater public key")?;
    let public =
        minisign_verify::PublicKey::decode(&public_text).context("not a minisign public key")?;
    let signature_text = decode_text(signature_b64, "the signature")?;
    let signature =
        minisign_verify::Signature::decode(&signature_text).context("not a minisign signature")?;
    public
        .verify(data, &signature, true)
        .map_err(|error| anyhow::anyhow!("signature does not verify: {error}"))?;
    let comment = signature.trusted_comment().to_owned();
    if let Some(expected) = expected_version {
        let signed = comment.split('\t').find_map(|field| field.strip_prefix("version:"));
        match signed {
            Some(signed) if signed.trim_start_matches('v') == expected.trim_start_matches('v') => {}
            Some(signed) => bail!("the signature is for version {signed}, not {expected}"),
            None => {
                bail!("the signature carries no version (requireSignedVersion would reject it)")
            }
        }
    }
    Ok(comment)
}

/// Key id of a `tauri.conf.json` public key, or an error when it is not a valid key
/// (for example the placeholder the shell starts with).
pub fn public_key_id(public_b64: &str) -> Result<String> {
    let text = decode_text(public_b64, "the updater public key")?;
    let public = PublicKey::from_box(
        minisign::PublicKeyBox::from_string(&text).context("not a public key box")?,
    )
    .context("not a minisign public key")?;
    Ok(key_id_hex(public.keynum()))
}

//! SHA-256 digests and `.sha256` side files in `shasum -a 256` format (`<hex>  <name>\n`).

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use sha2::{Digest, Sha256};

use crate::fsx;

pub fn sha256_bytes(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file =
        File::open(path).with_context(|| format!("could not open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read =
            file.read(&mut buffer).with_context(|| format!("could not read {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn side_file(path: &Path) -> PathBuf {
    fsx::with_suffix(path, ".sha256")
}

/// Writes `<path>.sha256` and returns the digest.
pub fn write_side_file(path: &Path) -> Result<String> {
    let digest = sha256_file(path)?;
    let name = fsx::file_name(path)?;
    fsx::write_atomic(&side_file(path), format!("{digest}  {name}\n").as_bytes())?;
    Ok(digest)
}

/// Checks `<path>.sha256` the way `stage-release.py` did: the whitespace-separated words must be
/// exactly the digest and the file name.
pub fn verify_side_file(path: &Path) -> Result<String> {
    let side = side_file(path);
    let text = std::fs::read_to_string(&side)
        .with_context(|| format!("missing checksum file {}", side.display()))?;
    let digest = sha256_file(path)?;
    let name = fsx::file_name(path)?;
    let words: Vec<&str> = text.split_whitespace().collect();
    if words != [digest.as_str(), name.as_str()] {
        bail!("checksum mismatch: {} does not match {}", side.display(), path.display());
    }
    Ok(digest)
}

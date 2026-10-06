//! The 1.x-format update ZIP, written the way `scripts/build-update.py` wrote it: entries under
//! `Azure timetracker.app/`, sorted, fixed 2026-01-01 00:00:00 timestamps, Unix mode 755/644,
//! deflate level 9, no extra fields, no comment, no data descriptors. Unlike the script there is
//! no five-file allowlist (a 2.x bundle has more files); symbolic links, special files and unsafe
//! names are refused instead, and empty folders get a folder entry so nothing is lost.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;

use super::archive::{self, CentralEntry, ROOT_PREFIX, read_uint};
use crate::consts::APP_DIR_NAME;
use crate::tree::{self, FileFacts, Kind};
use crate::{checksum, fsx};

/// DOS date for 2026-01-01 and time 00:00:00, as `build-update.py` used.
const DOS_DATE: u16 = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME: u16 = 0;
/// Version made by: Unix (3) and spec 2.0, like Python's zipfile.
const MADE_BY: u16 = (3 << 8) | 20;
const NEEDED: u16 = 20;

#[derive(Debug, Clone)]
pub struct ZipSummary {
    pub path: PathBuf,
    pub entries: usize,
    pub size: u64,
    pub sha256: String,
}

struct Pending {
    name: String,
    method: u16,
    crc32: u32,
    data: Vec<u8>,
    expanded: u64,
    mode: u32,
    external_extra: u32,
}

/// Builds the ZIP for `app` at `out` and returns its size and digest.
pub fn write_update_zip(app: &Path, out: &Path) -> Result<ZipSummary> {
    if app.file_name().and_then(|name| name.to_str()) != Some(APP_DIR_NAME) {
        bail!("expected {APP_DIR_NAME:?}, got {}", app.display());
    }
    let mut pending = Vec::new();
    for node in tree::ensure_plain_tree(app)? {
        let rel = node.rel();
        if !rel.chars().all(|c| c.is_ascii_graphic() || c == ' ') {
            bail!(
                "refusing the non-ASCII or control character in {rel:?} (keep bundle file names ASCII)"
            );
        }
        match node.kind {
            Kind::File { executable, .. } => {
                let name = format!("{ROOT_PREFIX}{rel}");
                archive::check_name(&name).map_err(anyhow::Error::msg)?;
                let bytes = fs::read(&node.path)
                    .with_context(|| format!("could not read {}", node.path.display()))?;
                if bytes.len() as u64 >= archive::MAX_ENTRY_SIZE {
                    bail!("{rel} is larger than the 512 MiB the 1.x client accepts");
                }
                let mut encoder = DeflateEncoder::new(Vec::new(), Compression::new(9));
                encoder.write_all(&bytes)?;
                let compressed = encoder.finish()?;
                pending.push(Pending {
                    name,
                    method: 8,
                    crc32: crc32fast::hash(&bytes),
                    expanded: bytes.len() as u64,
                    data: compressed,
                    mode: 0o100000 | if executable { 0o755 } else { 0o644 },
                    external_extra: 0,
                });
            }
            Kind::Dir { empty: true } => {
                let name = format!("{ROOT_PREFIX}{rel}/");
                archive::check_name(&name).map_err(anyhow::Error::msg)?;
                // Python's zipfile marks folders with the MS-DOS directory bit as well.
                pending.push(Pending {
                    name,
                    method: 0,
                    crc32: 0,
                    data: Vec::new(),
                    expanded: 0,
                    mode: 0o040755,
                    external_extra: 0x10,
                });
            }
            Kind::Dir { empty: false } => {}
            Kind::Symlink | Kind::Other => {
                unreachable!("ensure_plain_tree refuses links and special files")
            }
        }
    }
    if pending.len() as u64 > archive::MAX_ENTRIES {
        bail!("{} entries; the 1.x client accepts at most {}", pending.len(), archive::MAX_ENTRIES);
    }
    let bytes = encode(&pending)?;
    // The client check, applied to what was just written.
    archive::validate(&bytes).map_err(anyhow::Error::msg)?;
    fsx::write_atomic(out, &bytes)?;
    Ok(ZipSummary {
        path: out.to_owned(),
        entries: pending.len(),
        size: bytes.len() as u64,
        sha256: checksum::sha256_bytes(&bytes),
    })
}

fn u32_field(value: u64, what: &str) -> Result<u32> {
    u32::try_from(value).with_context(|| {
        format!("{what} exceeds the 4 GiB ZIP limit (ZIP64 is not supported by 1.x)")
    })
}

fn encode(entries: &[Pending]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for entry in entries {
        let offset = u32_field(out.len() as u64, "archive offset")?;
        let name = entry.name.as_bytes();
        let name_len = u16::try_from(name.len()).context("entry name too long")?;
        let compressed = u32_field(entry.data.len() as u64, "entry size")?;
        let expanded = u32_field(entry.expanded, "entry size")?;
        // Local file header.
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&NEEDED.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // flags
        out.extend_from_slice(&entry.method.to_le_bytes());
        out.extend_from_slice(&DOS_TIME.to_le_bytes());
        out.extend_from_slice(&DOS_DATE.to_le_bytes());
        out.extend_from_slice(&entry.crc32.to_le_bytes());
        out.extend_from_slice(&compressed.to_le_bytes());
        out.extend_from_slice(&expanded.to_le_bytes());
        out.extend_from_slice(&name_len.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra length
        out.extend_from_slice(name);
        out.extend_from_slice(&entry.data);
        // Central directory record.
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&MADE_BY.to_le_bytes());
        central.extend_from_slice(&NEEDED.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // flags
        central.extend_from_slice(&entry.method.to_le_bytes());
        central.extend_from_slice(&DOS_TIME.to_le_bytes());
        central.extend_from_slice(&DOS_DATE.to_le_bytes());
        central.extend_from_slice(&entry.crc32.to_le_bytes());
        central.extend_from_slice(&compressed.to_le_bytes());
        central.extend_from_slice(&expanded.to_le_bytes());
        central.extend_from_slice(&name_len.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // extra length
        central.extend_from_slice(&0u16.to_le_bytes()); // comment length
        central.extend_from_slice(&0u16.to_le_bytes()); // disk number start
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attributes
        central.extend_from_slice(&((entry.mode << 16) | entry.external_extra).to_le_bytes());
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name);
    }
    let directory_offset = u32_field(out.len() as u64, "archive offset")?;
    let directory_size = u32_field(central.len() as u64, "central directory")?;
    let count = u16::try_from(entries.len()).context("too many entries")?;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // this disk
    out.extend_from_slice(&0u16.to_le_bytes()); // disk with the central directory
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&directory_size.to_le_bytes());
    out.extend_from_slice(&directory_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment length
    Ok(out)
}

/// The uncompressed bytes of one validated entry, with size and CRC-32 checked.
pub fn read_entry(data: &[u8], entry: &CentralEntry) -> Result<Vec<u8>> {
    let local = entry.local_offset;
    let name_length = read_uint(data, local + 26, 2).map_err(anyhow::Error::msg)?;
    let extra = read_uint(data, local + 28, 2).map_err(anyhow::Error::msg)?;
    let start = local + 30 + name_length + extra;
    let end = start + entry.compressed_size;
    if end > data.len() as u64 {
        bail!("{} extends beyond the archive", entry.name);
    }
    let raw = &data[start as usize..end as usize];
    let bytes = match entry.method {
        0 => raw.to_vec(),
        8 => {
            let mut bytes = Vec::with_capacity(entry.expanded_size as usize);
            DeflateDecoder::new(raw)
                .take(entry.expanded_size + 1)
                .read_to_end(&mut bytes)
                .with_context(|| format!("could not inflate {}", entry.name))?;
            bytes
        }
        other => bail!("unsupported compression method {other}"),
    };
    if bytes.len() as u64 != entry.expanded_size || crc32fast::hash(&bytes) != entry.crc32 {
        bail!("{} fails its size or CRC-32 check", entry.name);
    }
    Ok(bytes)
}

/// Same shape as [`tree::inventory`] for the bundle inside the archive.
pub fn inventory(data: &[u8], entries: &[CentralEntry]) -> Result<BTreeMap<String, FileFacts>> {
    let mut map = BTreeMap::new();
    for entry in entries {
        let rel = entry.name.strip_prefix(ROOT_PREFIX).unwrap_or(&entry.name);
        if entry.is_dir() {
            let folder = rel.trim_end_matches('/');
            let prefix = format!("{ROOT_PREFIX}{folder}/");
            let has_children =
                entries.iter().any(|other| other.name.starts_with(&prefix) && other.name != prefix);
            if !folder.is_empty() && !has_children {
                map.insert(
                    format!("{folder}/"),
                    FileFacts { sha256: String::new(), executable: true },
                );
            }
            continue;
        }
        let bytes = read_entry(data, entry)?;
        map.insert(
            rel.to_owned(),
            FileFacts {
                sha256: checksum::sha256_bytes(&bytes),
                executable: entry.unix_mode & 0o111 != 0,
            },
        );
    }
    Ok(map)
}

/// Portable extraction into `destination` (which must not exist), for hosts without `ditto`.
pub fn extract(data: &[u8], entries: &[CentralEntry], destination: &Path) -> Result<PathBuf> {
    fs::create_dir(destination)
        .with_context(|| format!("could not create {}", destination.display()))?;
    for entry in entries {
        // Names were validated: fixed prefix, no `..`, `.`, `//` or backslashes.
        let target = destination.join(entry.name.trim_end_matches('/'));
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, read_entry(data, entry)?)?;
        fsx::set_mode(&target, if entry.unix_mode & 0o111 != 0 { 0o755 } else { 0o644 })?;
    }
    Ok(destination.join(APP_DIR_NAME))
}

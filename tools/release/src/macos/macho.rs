//! Mach-O headers, read directly so checks do not depend on `lipo`.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use anyhow::{Context, Result, bail};

const FAT_MAGIC: u32 = 0xcafe_babe;
const FAT_MAGIC_64: u32 = 0xcafe_babf;
const MH_MAGIC: u32 = 0xfeed_face;
const MH_MAGIC_64: u32 = 0xfeed_facf;

fn cpu_name(cpu_type: u32) -> String {
    match cpu_type {
        0x0100_0007 => "x86_64".to_owned(),
        0x0100_000c => "arm64".to_owned(),
        7 => "i386".to_owned(),
        12 => "arm".to_owned(),
        other => format!("cpu-{other:#x}"),
    }
}

fn head(path: &Path) -> Result<Vec<u8>> {
    let mut buffer = Vec::new();
    File::open(path)
        .with_context(|| format!("could not open {}", path.display()))?
        .take(4096)
        .read_to_end(&mut buffer)?;
    Ok(buffer)
}

fn be(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes.get(offset..offset + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

fn le(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes.get(offset..offset + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Architectures of a thin or universal Mach-O file; `None` when the file is not Mach-O.
pub fn architectures(path: &Path) -> Result<Option<Vec<String>>> {
    let bytes = head(path)?;
    let Some(magic_be) = be(&bytes, 0) else { return Ok(None) };
    if magic_be == FAT_MAGIC || magic_be == FAT_MAGIC_64 {
        let count = be(&bytes, 4).unwrap_or(0) as usize;
        // Java class files share 0xcafebabe; their "count" is a class-file version (≥ 45).
        if count == 0 || count > 30 {
            return Ok(None);
        }
        let stride = if magic_be == FAT_MAGIC { 20 } else { 32 };
        let mut names = Vec::new();
        for index in 0..count {
            let cpu = be(&bytes, 8 + index * stride).context("truncated universal header")?;
            names.push(cpu_name(cpu));
        }
        return Ok(Some(names));
    }
    match le(&bytes, 0) {
        Some(MH_MAGIC) | Some(MH_MAGIC_64) => Ok(Some(vec![cpu_name(le(&bytes, 4).unwrap_or(0))])),
        _ => Ok(None),
    }
}

pub fn is_macho(path: &Path) -> Result<bool> {
    Ok(architectures(path)?.is_some())
}

/// Both Apple Silicon and Intel slices must be present.
pub fn require_universal(path: &Path) -> Result<()> {
    let Some(names) = architectures(path)? else {
        bail!("{} is not a Mach-O executable", path.display())
    };
    for wanted in ["arm64", "x86_64"] {
        if !names.iter().any(|name| name == wanted) {
            bail!("{} is not universal: it has {names:?}, missing {wanted}", path.display());
        }
    }
    Ok(())
}

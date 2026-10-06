//! The Tauri updater archive for macOS: a gzip'd tar whose single top-level folder is the app,
//! the layout `tauri-bundler` produces. The updater plugin skips the first path component of
//! every entry, unpacks into a temporary folder and swaps it in place of the running bundle.
//!
//! This tool writes the archive itself because the bundle is re-signed after `tauri build`.
//! Headers are deterministic: sorted entries, fixed mtime, uid/gid 0, mode 755/644.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use tar::{EntryType, Header};

use crate::consts::APP_DIR_NAME;
use crate::tree::{self, Kind};

/// 2026-01-01T00:00:00Z, the same fixed date as the legacy ZIP.
const MTIME: u64 = 1_767_225_600;

fn header(kind: EntryType, mode: u32, size: u64) -> Header {
    let mut header = Header::new_gnu();
    header.set_entry_type(kind);
    header.set_mode(mode);
    header.set_size(size);
    header.set_mtime(MTIME);
    header.set_uid(0);
    header.set_gid(0);
    header
}

/// Writes `out` from `app` (named `Azure timetracker.app`).
pub fn create(app: &Path, out: &Path) -> Result<()> {
    if app.file_name().and_then(|name| name.to_str()) != Some(APP_DIR_NAME) {
        bail!("expected {APP_DIR_NAME:?}, got {}", app.display());
    }
    let nodes = tree::ensure_plain_tree(app)?;
    let parent =
        out.parent().filter(|parent| !parent.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = tempfile::Builder::new().prefix(".att-release-").tempfile_in(parent)?;
    {
        let encoder = GzEncoder::new(BufWriter::new(temporary.as_file()), Compression::best());
        let mut builder = tar::Builder::new(encoder);
        let mut root = header(EntryType::Directory, 0o755, 0);
        builder.append_data(&mut root, format!("{APP_DIR_NAME}/"), std::io::empty())?;
        for node in nodes {
            let name = format!("{APP_DIR_NAME}/{}", node.rel());
            match node.kind {
                Kind::Dir { .. } => {
                    let mut dir = header(EntryType::Directory, 0o755, 0);
                    builder.append_data(&mut dir, format!("{name}/"), std::io::empty())?;
                }
                Kind::File { executable, len } => {
                    let mut file =
                        header(EntryType::Regular, if executable { 0o755 } else { 0o644 }, len);
                    let reader = BufReader::new(File::open(&node.path)?);
                    builder.append_data(&mut file, &name, reader)?;
                }
                Kind::Symlink | Kind::Other => {
                    unreachable!("ensure_plain_tree refuses links and special files")
                }
            }
        }
        let encoder = builder.into_inner()?;
        encoder.finish()?.into_inner().map_err(|error| error.into_error())?.sync_all()?;
    }
    temporary
        .persist(out)
        .map_err(|error| error.error)
        .with_context(|| format!("could not write {}", out.display()))?;
    crate::fsx::set_mode(out, 0o644)?;
    Ok(())
}

/// Unpacks `archive` the way the updater plugin does and returns `<destination>/Azure timetracker.app`.
/// Stricter than the plugin: every entry must sit under one `Azure timetracker.app/` folder and be
/// a regular file or folder.
pub fn extract(archive: &Path, destination: &Path) -> Result<PathBuf> {
    let app = destination.join(APP_DIR_NAME);
    fs::create_dir_all(&app)?;
    let file =
        File::open(archive).with_context(|| format!("could not open {}", archive.display()))?;
    let mut tar = tar::Archive::new(GzDecoder::new(BufReader::new(file)));
    let mut count = 0usize;
    for entry in tar.entries().context("not a gzip'd tar archive")? {
        let mut entry = entry.context("corrupt archive entry")?;
        let path = entry.path()?.into_owned();
        let mut components = path.components();
        match components.next() {
            Some(Component::Normal(first)) if first == APP_DIR_NAME => {}
            _ => bail!(
                "{} has an entry outside {APP_DIR_NAME}/: {}",
                archive.display(),
                path.display()
            ),
        }
        let rest: PathBuf = components.clone().collect();
        if components.any(|component| !matches!(component, Component::Normal(_))) {
            bail!("unsafe path in {}: {}", archive.display(), path.display());
        }
        match entry.header().entry_type() {
            EntryType::Regular | EntryType::Directory => {}
            other => bail!(
                "{} contains a {other:?} entry ({}); only files and folders are allowed",
                archive.display(),
                path.display()
            ),
        }
        let target = app.join(&rest);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        entry.unpack(&target).with_context(|| format!("could not unpack {}", path.display()))?;
        count += 1;
    }
    if count == 0 {
        bail!("{} is empty", archive.display());
    }
    Ok(app)
}

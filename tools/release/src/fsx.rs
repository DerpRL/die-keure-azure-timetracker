//! Small filesystem helpers shared by the subcommands.

use std::fs::{self, Metadata};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail};

/// `name.ext` + `suffix` → `name.ext<suffix>` (for `.sig` and `.sha256` side files).
pub fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

pub fn file_name(path: &Path) -> Result<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .with_context(|| format!("{} has no UTF-8 file name", path.display()))
}

/// Writes through a temporary file in the same folder, then renames it into place.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    let parent =
        path.parent().filter(|parent| !parent.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::create_dir_all(parent).with_context(|| format!("could not create {}", parent.display()))?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".att-release-")
        .tempfile_in(parent)
        .with_context(|| format!("could not create a temporary file in {}", parent.display()))?;
    temporary.write_all(data)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| error.error)
        .with_context(|| format!("could not write {}", path.display()))?;
    #[cfg(unix)]
    set_mode(path, 0o644)?;
    Ok(())
}

/// Copies a file and keeps its permission bits.
pub fn copy_file(source: &Path, target: &Path) -> Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("could not create {}", parent.display()))?;
    }
    fs::copy(source, target)
        .with_context(|| format!("could not copy {} to {}", source.display(), target.display()))?;
    Ok(())
}

pub fn same_bytes(left: &Path, right: &Path) -> Result<bool> {
    let left_meta =
        fs::metadata(left).with_context(|| format!("could not read {}", left.display()))?;
    let right_meta =
        fs::metadata(right).with_context(|| format!("could not read {}", right.display()))?;
    if left_meta.len() != right_meta.len() {
        return Ok(false);
    }
    Ok(fs::read(left)? == fs::read(right)?)
}

/// Absolute path with symbolic links resolved for the part that exists; the missing tail is
/// appended as-is. Used for "is this inside the repository?" checks on paths not created yet.
pub fn resolve(path: &Path) -> Result<PathBuf> {
    let absolute =
        std::path::absolute(path).with_context(|| format!("invalid path {}", path.display()))?;
    let mut existing = absolute.as_path();
    let mut tail = Vec::new();
    while fs::symlink_metadata(existing).is_err() {
        let name =
            existing.file_name().with_context(|| format!("invalid path {}", path.display()))?;
        tail.push(name.to_os_string());
        existing = existing.parent().with_context(|| format!("invalid path {}", path.display()))?;
    }
    let mut resolved = fs::canonicalize(existing)
        .with_context(|| format!("could not resolve {}", existing.display()))?;
    for name in tail.iter().rev() {
        if Path::new(name)
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        {
            bail!("refusing the relative path component in {}", path.display());
        }
        resolved.push(name);
    }
    Ok(resolved)
}

pub fn is_inside(path: &Path, root: &Path) -> Result<bool> {
    Ok(resolve(path)?.starts_with(resolve(root)?))
}

/// Secrets must not live in a Git work tree: the repository itself, or any checkout found above
/// the path. The search stops at the home folder so a dotfiles repository in `~` does not block
/// `~/Library/Application Support`.
pub fn refuse_inside_repository(path: &Path, repository: Option<&Path>, what: &str) -> Result<()> {
    let resolved = resolve(path)?;
    if let Some(repository) = repository
        && resolved.starts_with(resolve(repository)?)
    {
        bail!(
            "{what} must be outside the Git repository ({} is inside {})",
            path.display(),
            repository.display()
        );
    }
    let home = dirs::home_dir().and_then(|home| fs::canonicalize(home).ok());
    for ancestor in resolved.ancestors().skip(1) {
        if home.as_deref() == Some(ancestor) {
            break;
        }
        if ancestor.join(".git").exists() {
            bail!(
                "{what} must be outside any Git work tree ({} is inside {})",
                path.display(),
                ancestor.display()
            );
        }
    }
    Ok(())
}

#[cfg(unix)]
pub fn mode(meta: &Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode()
}

#[cfg(not(unix))]
pub fn mode(meta: &Metadata) -> u32 {
    if meta.is_dir() { 0o755 } else { 0o644 }
}

/// Any execute bit, like Python's `os.access(path, os.X_OK)` for the file owner.
pub fn is_executable(meta: &Metadata) -> bool {
    mode(meta) & 0o111 != 0
}

#[cfg(unix)]
pub fn set_mode(path: &Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .with_context(|| format!("could not set permissions on {}", path.display()))
}

#[cfg(not(unix))]
pub fn set_mode(_path: &Path, _mode: u32) -> Result<()> {
    Ok(())
}

/// Creates a folder that only the owner can read (700), like the legacy key folder.
pub fn ensure_private_dir(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::create_dir_all(path).with_context(|| format!("could not create {}", path.display()))?;
        set_mode(path, 0o700)?;
    }
    Ok(())
}

/// Refuses key files that group or others can read (mode must be 600 or stricter).
#[cfg(unix)]
pub fn check_private_file(path: &Path) -> Result<()> {
    let meta = fs::metadata(path).with_context(|| format!("could not read {}", path.display()))?;
    if mode(&meta) & 0o077 != 0 {
        bail!("{} must have permissions 600 (run: chmod 600 '{}')", path.display(), path.display());
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn check_private_file(path: &Path) -> Result<()> {
    fs::metadata(path).with_context(|| format!("could not read {}", path.display()))?;
    Ok(())
}

#[cfg(unix)]
pub fn symlink(target: &Path, link: &Path) -> Result<()> {
    std::os::unix::fs::symlink(target, link)
        .with_context(|| format!("could not create the symbolic link {}", link.display()))
}

#[cfg(not(unix))]
pub fn symlink(_target: &Path, link: &Path) -> Result<()> {
    bail!("symbolic links are only created on macOS ({})", link.display())
}

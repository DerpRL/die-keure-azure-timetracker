//! Walking an app bundle without following links, and byte-level inventories for comparing
//! the app inside the DMG, the updater archive and the legacy ZIP.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::{checksum, fsx};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    Dir {
        empty: bool,
    },
    File {
        executable: bool,
        len: u64,
    },
    Symlink,
    /// FIFOs, sockets, devices.
    Other,
}

#[derive(Debug, Clone)]
pub struct Node {
    /// Path components below the root, e.g. `["Contents", "MacOS", "AzureTimetracker"]`.
    pub components: Vec<String>,
    pub kind: Kind,
    pub path: PathBuf,
}

impl Node {
    pub fn rel(&self) -> String {
        self.components.join("/")
    }
}

/// Every entry below `root` in pre-order with siblings sorted by name, which equals sorting the
/// relative paths by their components (what `build-update.py` did with `sorted(Path)`).
pub fn walk(root: &Path) -> Result<Vec<Node>> {
    let meta =
        fs::symlink_metadata(root).with_context(|| format!("could not read {}", root.display()))?;
    if !meta.is_dir() {
        bail!("{} is not a folder (symbolic links to bundles are refused)", root.display());
    }
    let mut nodes = Vec::new();
    visit(root, &mut Vec::new(), &mut nodes)?;
    Ok(nodes)
}

fn visit(dir: &Path, prefix: &mut Vec<String>, nodes: &mut Vec<Node>) -> Result<()> {
    let mut children = Vec::new();
    for entry in fs::read_dir(dir).with_context(|| format!("could not list {}", dir.display()))? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|name| anyhow::anyhow!("non-UTF-8 file name {name:?} in {}", dir.display()))?;
        children.push((name, entry.path()));
    }
    children.sort();
    for (name, path) in children {
        let meta = fs::symlink_metadata(&path)
            .with_context(|| format!("could not read {}", path.display()))?;
        prefix.push(name);
        let kind = if meta.file_type().is_symlink() {
            Kind::Symlink
        } else if meta.is_dir() {
            let empty = fs::read_dir(&path)?.next().is_none();
            Kind::Dir { empty }
        } else if meta.is_file() {
            Kind::File { executable: fsx::is_executable(&meta), len: meta.len() }
        } else {
            Kind::Other
        };
        let is_dir = matches!(kind, Kind::Dir { .. });
        nodes.push(Node { components: prefix.clone(), kind, path: path.clone() });
        if is_dir {
            visit(&path, prefix, nodes)?;
        }
        prefix.pop();
    }
    Ok(())
}

/// Refuses symbolic links and special files anywhere below `root`.
pub fn ensure_plain_tree(root: &Path) -> Result<Vec<Node>> {
    let nodes = walk(root)?;
    for node in &nodes {
        match node.kind {
            Kind::Symlink => bail!(
                "symbolic link {} in {}: 1.x updates refuse symbolic links inside the bundle",
                node.rel(),
                root.display()
            ),
            Kind::Other => bail!("special file {} in {}", node.rel(), root.display()),
            _ => {}
        }
    }
    Ok(nodes)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFacts {
    pub sha256: String,
    pub executable: bool,
}

/// Relative path → digest and executable bit for every regular file; empty folders are listed
/// with an empty digest so that a lost empty folder is noticed too.
pub fn inventory(root: &Path) -> Result<BTreeMap<String, FileFacts>> {
    let mut map = BTreeMap::new();
    for node in ensure_plain_tree(root)? {
        match node.kind {
            Kind::File { executable, .. } => {
                map.insert(
                    node.rel(),
                    FileFacts { sha256: checksum::sha256_file(&node.path)?, executable },
                );
            }
            Kind::Dir { empty: true } => {
                map.insert(
                    format!("{}/", node.rel()),
                    FileFacts { sha256: String::new(), executable: true },
                );
            }
            _ => {}
        }
    }
    Ok(map)
}

/// Describes the first differences between two inventories (empty when identical).
pub fn differences(
    left_name: &str,
    left: &BTreeMap<String, FileFacts>,
    right_name: &str,
    right: &BTreeMap<String, FileFacts>,
) -> Vec<String> {
    let mut problems = Vec::new();
    for (path, facts) in left {
        match right.get(path) {
            None => problems.push(format!("{path} is in {left_name} but not in {right_name}")),
            Some(other) if other.sha256 != facts.sha256 => {
                problems.push(format!("{path} differs between {left_name} and {right_name}"))
            }
            Some(other) if other.executable != facts.executable => problems.push(format!(
                "{path} has a different executable bit in {left_name} and {right_name}"
            )),
            _ => {}
        }
    }
    for path in right.keys().filter(|path| !left.contains_key(*path)) {
        problems.push(format!("{path} is in {right_name} but not in {left_name}"));
    }
    problems.truncate(20);
    problems
}

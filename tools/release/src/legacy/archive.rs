//! Port of `UpdateArchive.validate` from `Sources/AzureTimetrackerCore/AppUpdates.swift`: the ZIP
//! layout rules a 1.13–1.14.x client enforces before it extracts an update. The client reports a
//! single generic message; the port adds the reason.

use std::collections::HashSet;
use std::fmt;

pub const ROOT_PREFIX: &str = "Azure timetracker.app/";
pub const REQUIRED_ENTRIES: [&str; 3] = [
    "Azure timetracker.app/Contents/Info.plist",
    "Azure timetracker.app/Contents/MacOS/AzureTimetracker",
    "Azure timetracker.app/Contents/Helpers/AzureTimetrackerUpdater",
];
pub const MAX_ENTRIES: u64 = 4096;
pub const MAX_ENTRY_SIZE: u64 = 512 * 1024 * 1024;
pub const MAX_TOTAL_SIZE: u64 = 1024 * 1024 * 1024;

const END_OF_CENTRAL_DIRECTORY: u64 = 0x0605_4b50;
const CENTRAL_DIRECTORY_ENTRY: u64 = 0x0201_4b50;
const LOCAL_FILE_HEADER: u64 = 0x0403_4b50;

/// One central-directory record that passed validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CentralEntry {
    pub name: String,
    pub flags: u16,
    pub method: u16,
    pub crc32: u32,
    pub compressed_size: u64,
    pub expanded_size: u64,
    /// Upper 16 bits of the external attributes (Unix `st_mode`).
    pub unix_mode: u32,
    pub local_offset: u64,
}

impl CentralEntry {
    pub fn is_dir(&self) -> bool {
        self.unix_mode & 0xf000 == 0x4000 || self.name.ends_with('/')
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutError(pub String);

impl fmt::Display for LayoutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "The update archive has an unsupported or unsafe layout ({}).", self.0)
    }
}

impl std::error::Error for LayoutError {}

fn fail(reason: impl Into<String>) -> LayoutError {
    LayoutError(reason.into())
}

/// Little-endian unsigned integer of `count` bytes; out-of-range reads fail like Swift's `uint`.
pub(crate) fn read_uint(data: &[u8], offset: u64, count: usize) -> Result<u64, LayoutError> {
    let len = data.len() as u64;
    if count > 4 || count as u64 > len || offset > len - count as u64 {
        return Err(fail("truncated record"));
    }
    let start = offset as usize;
    Ok((0..count)
        .fold(0u64, |value, index| value | (u64::from(data[start + index]) << (8 * index))))
}

/// The entry-name rules (separators, control characters, prefix, `..` and `.` components).
pub fn check_name(name: &str) -> Result<(), LayoutError> {
    let unsafe_name = name.contains('\\')
        || name.contains("//")
        || name.chars().any(|c| (c as u32) < 32 || c as u32 == 127)
        || !name.starts_with(ROOT_PREFIX)
        || name.split('/').any(|part| part == "..")
        || name.split('/').filter(|part| !part.is_empty()).any(|part| part == ".");
    if unsafe_name { Err(fail(format!("unsafe entry name {name:?}"))) } else { Ok(()) }
}

pub fn validate(data: &[u8]) -> Result<Vec<CentralEntry>, LayoutError> {
    let len = data.len() as u64;
    if len < 22 {
        return Err(fail("shorter than an end-of-central-directory record"));
    }
    // The end record must end the file exactly (its comment included).
    let lowest = len.saturating_sub(65557);
    let mut offset = len - 22;
    let footer = loop {
        if read_uint(data, offset, 4)? == END_OF_CENTRAL_DIRECTORY
            && offset + 22 + read_uint(data, offset + 20, 2)? == len
        {
            break offset;
        }
        if offset == lowest {
            return Err(fail("no end-of-central-directory record at the end of the file"));
        }
        offset -= 1;
    };
    if read_uint(data, footer + 4, 2)? != 0 || read_uint(data, footer + 6, 2)? != 0 {
        return Err(fail("multi-disk archives are not supported"));
    }
    let count = read_uint(data, footer + 10, 2)?;
    let directory_size = read_uint(data, footer + 12, 4)?;
    let directory = read_uint(data, footer + 16, 4)?;
    if count == 0
        || count > MAX_ENTRIES
        || read_uint(data, footer + 8, 2)? != count
        || directory + directory_size != footer
    {
        return Err(fail(
            "unexpected entry count or central directory position (empty, over 4096 entries, or ZIP64)",
        ));
    }
    let mut cursor = directory;
    let mut total = 0u64;
    let mut names = HashSet::new();
    let mut entries = Vec::new();
    for _ in 0..count {
        if read_uint(data, cursor, 4)? != CENTRAL_DIRECTORY_ENTRY {
            return Err(fail("malformed central directory"));
        }
        let flags = read_uint(data, cursor + 8, 2)?;
        if flags & 1 != 0 {
            return Err(fail("encrypted entries are not supported"));
        }
        let method = read_uint(data, cursor + 10, 2)?;
        let crc32 = read_uint(data, cursor + 16, 4)?;
        let compressed_size = read_uint(data, cursor + 20, 4)?;
        let expanded = read_uint(data, cursor + 24, 4)?;
        let name_length = read_uint(data, cursor + 28, 2)?;
        let extra = read_uint(data, cursor + 30, 2)?;
        let comment = read_uint(data, cursor + 32, 2)?;
        let external = read_uint(data, cursor + 38, 4)?;
        let mode = (external >> 16) & 0xf000;
        let local = read_uint(data, cursor + 42, 4)?;
        let end = cursor + 46 + name_length;
        if method != 0 && method != 8 {
            return Err(fail(format!(
                "compression method {method} (only stored and deflated are supported)"
            )));
        }
        if !(mode == 0 || mode == 0x8000 || mode == 0x4000) {
            return Err(fail(format!(
                "file type {mode:#o} (only regular files and folders; symbolic links are refused)"
            )));
        }
        if end > footer || end + extra + comment > footer || name_length == 0 {
            return Err(fail("entry name outside the central directory"));
        }
        let raw_name = &data[(cursor + 46) as usize..end as usize];
        let name = std::str::from_utf8(raw_name).map_err(|_| fail("entry name is not UTF-8"))?;
        check_name(name)?;
        if !names.insert(name.to_owned()) {
            return Err(fail(format!("duplicate entry {name:?}")));
        }
        total += expanded;
        if expanded >= MAX_ENTRY_SIZE || total >= MAX_TOTAL_SIZE {
            return Err(fail(format!(
                "{name:?} expands beyond the 512 MiB entry or 1 GiB archive limit"
            )));
        }
        let local_matches = local < directory
            && read_uint(data, local, 4)? == LOCAL_FILE_HEADER
            && read_uint(data, local + 26, 2)? == name_length
            && local + 30 + name_length <= directory
            && data[(local + 30) as usize..(local + 30 + name_length) as usize] == *raw_name;
        if !local_matches {
            return Err(fail(format!(
                "local header of {name:?} does not match the central directory"
            )));
        }
        entries.push(CentralEntry {
            name: name.to_owned(),
            flags: flags as u16,
            method: method as u16,
            crc32: crc32 as u32,
            compressed_size,
            expanded_size: expanded,
            unix_mode: (external >> 16) as u32,
            local_offset: local,
        });
        cursor = end + extra + comment;
    }
    if cursor != footer {
        return Err(fail("unexpected data between the central directory and its end record"));
    }
    for required in REQUIRED_ENTRIES {
        if !names.contains(required) {
            return Err(fail(format!("missing {required}")));
        }
    }
    Ok(entries)
}

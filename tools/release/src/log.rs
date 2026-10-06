//! Progress output. Everything goes to stderr so that stdout carries only results that scripts can
//! capture (the app path from `build-macos`, the public key from `keygen-v2`, ...).

use std::fmt::Display;

pub fn step(message: impl Display) {
    eprintln!("==> {message}");
}

pub fn info(message: impl Display) {
    eprintln!("    {message}");
}

pub fn ok(message: impl Display) {
    eprintln!("    ok: {message}");
}

pub fn warn(message: impl Display) {
    eprintln!("WARNING: {message}");
}

/// A boxed warning that is hard to miss in a long log.
pub fn loud(lines: &[&str]) {
    let width = lines.iter().map(|line| line.chars().count()).max().unwrap_or(0) + 4;
    let bar = "!".repeat(width);
    eprintln!("{bar}");
    for line in lines {
        let pad = width - 4 - line.chars().count();
        eprintln!("! {line}{} !", " ".repeat(pad));
    }
    eprintln!("{bar}");
}

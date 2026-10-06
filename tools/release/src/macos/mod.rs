//! macOS-only steps (codesign, hdiutil, lipo). The code compiles everywhere; the tools exist only
//! on macOS.

pub mod codesign;
pub mod dmg;
pub mod macho;
pub mod stub;

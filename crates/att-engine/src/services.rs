//! Everything the engine needs from the outside world.

use std::path::PathBuf;
use std::sync::Arc;

use att_core::model::HostOs;
use att_platform::Platform;
use att_store::Store;

use crate::clients::ClientFactory;
use crate::clock::Clock;
use crate::shell::Shell;

#[derive(Clone)]
pub struct Services {
    pub platform: Platform,
    pub store: Arc<Store>,
    pub shell: Arc<dyn Shell>,
    pub clock: Arc<dyn Clock>,
    pub clients: Arc<dyn ClientFactory>,
    /// Preview mode: no network requests, credential writes or calendar access (Swift
    /// `--preview`).
    pub preview: bool,
    pub os: HostOs,
    /// The 1.14.x data folder to import once, or `None` to never import (previews, a custom data
    /// folder, tests). Only the app's default data folder imports, so nothing but the real app
    /// ever reads `~/Library/Application Support/Azure timetracker` or writes its marker file.
    pub legacy_dir: Option<PathBuf>,
    /// Watch the watched repositories' HEAD files, so a checkout is noticed within a second
    /// instead of on the next probe interval. Off in [`TestEngine`](crate::testing::TestEngine)
    /// unless a test asks for it, so tick-driven tests stay deterministic.
    pub file_events: bool,
}

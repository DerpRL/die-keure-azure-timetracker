//! Everything the engine needs from the outside world.

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
}

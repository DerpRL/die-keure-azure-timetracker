//! COM apartment for the calling thread.
//!
//! The engine calls probes from a blocking thread pool, so COM is entered per call: the scope
//! joins the multithreaded apartment and leaves it when dropped. A process-wide
//! `CoIncrementMTAUsage` cookie keeps the MTA alive between calls, so entering it again is cheap
//! and objects never outlive their apartment. Every COM object must be dropped before the scope;
//! callers create them in a function that the scope outlives.

use std::marker::PhantomData;
use std::sync::Once;

use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::System::Com::{
    COINIT_MULTITHREADED, CoIncrementMTAUsage, CoInitializeEx, CoUninitialize,
};

/// Initialises COM on this thread until dropped. Not `Send`: it must be dropped on the thread
/// that created it.
pub(crate) struct ComScope {
    uninitialize: bool,
    _thread_bound: PhantomData<*const ()>,
}

impl ComScope {
    pub(crate) fn enter() -> windows::core::Result<Self> {
        static KEEP_MTA_ALIVE: Once = Once::new();
        KEEP_MTA_ALIVE.call_once(|| {
            // SAFETY: no preconditions. The cookie is never released on purpose: it keeps the
            // MTA alive for the lifetime of the process.
            if let Err(error) = unsafe { CoIncrementMTAUsage() } {
                tracing::debug!(%error, "CoIncrementMTAUsage failed");
            }
        });
        // SAFETY: balanced by `CoUninitialize` in `Drop` on this thread when it succeeds.
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result == RPC_E_CHANGED_MODE {
            // The thread already lives in a single-threaded apartment (for example a UI thread).
            // COM works there too; it is not ours to uninitialise.
            return Ok(Self { uninitialize: false, _thread_bound: PhantomData });
        }
        result.ok()?;
        Ok(Self { uninitialize: true, _thread_bound: PhantomData })
    }
}

impl Drop for ComScope {
    fn drop(&mut self) {
        if self.uninitialize {
            // SAFETY: pairs with the successful `CoInitializeEx` in `enter` on this thread.
            unsafe { CoUninitialize() };
        }
    }
}

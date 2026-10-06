//! Generation tokens and the busy guard.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// A monotonically increasing token. Capture it before an `.await`; after the await, drop the
/// result unless [`Generation::is_current`] still holds (Swift compared `UUID` generations).
#[derive(Debug, Default)]
pub struct Generation(AtomicU64);

impl Generation {
    /// Invalidates every captured token and returns the new one.
    pub fn bump(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn current(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }

    pub fn is_current(&self, token: u64) -> bool {
        self.current() == token
    }
}

/// Serializes remote writes. [`Busy::try_acquire`] fails instead of waiting, so a second
/// tracking change while one is in flight is refused (Swift `guard !busy`).
#[derive(Debug, Default, Clone)]
pub struct Busy(Arc<AtomicBool>);

impl Busy {
    pub fn try_acquire(&self) -> Option<BusyGuard> {
        self.0
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| BusyGuard(self.0.clone()))
    }

    pub fn is_busy(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Releases [`Busy`] when dropped, including on early returns and errors.
#[derive(Debug)]
pub struct BusyGuard(Arc<AtomicBool>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_refuses_a_second_writer_until_released() {
        let busy = Busy::default();
        let first = busy.try_acquire().expect("free");
        assert!(busy.is_busy());
        assert!(busy.try_acquire().is_none());
        drop(first);
        assert!(busy.try_acquire().is_some());
    }

    #[test]
    fn generations_invalidate_earlier_tokens() {
        let generation = Generation::default();
        let token = generation.bump();
        assert!(generation.is_current(token));
        generation.bump();
        assert!(!generation.is_current(token));
    }
}

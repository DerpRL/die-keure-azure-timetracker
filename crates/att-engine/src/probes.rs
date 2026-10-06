//! Runs blocking OS probes off the async threads, with a deadline.

use std::time::Duration;

/// Default deadline for one probe call (Git HEAD, presence, microphone, Figma).
pub const PROBE_DEADLINE: Duration = Duration::from_secs(2);

/// Runs `f` on the blocking pool. `None` when it panicked or missed `deadline`; a late result
/// is discarded, never applied.
pub async fn blocking<T, F>(deadline: Duration, f: F) -> Option<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    match tokio::time::timeout(deadline, tokio::task::spawn_blocking(f)).await {
        Ok(Ok(value)) => Some(value),
        Ok(Err(_)) => None,
        Err(_) => {
            tracing::debug!("probe missed its {deadline:?} deadline");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn late_probes_are_discarded() {
        assert_eq!(blocking(Duration::from_secs(1), || 7).await, Some(7));
        let late = blocking(Duration::from_millis(20), || {
            std::thread::sleep(Duration::from_millis(200));
            1
        })
        .await;
        assert_eq!(late, None);
        assert_eq!(blocking(Duration::from_secs(1), || -> i32 { panic!("probe") }).await, None);
    }
}

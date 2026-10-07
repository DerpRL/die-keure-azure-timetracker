//! A dedicated thread that owns a non-thread-safe value (the EventKit store) and runs jobs
//! against it one at a time. Callers wait a bounded time; a slow job never blocks them longer.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use objc2::rc::autoreleasepool;

use crate::{PlatformError, Result};

/// Jobs that may wait behind a slow one before new calls fail fast.
const MAX_PENDING: usize = 4;

type Job<S> = Box<dyn FnOnce(&S) + Send>;

struct Worker<S> {
    jobs: mpsc::Sender<Job<S>>,
    pending: Arc<AtomicUsize>,
}

/// Owns `S` on its own thread, created lazily by `init` on the first [`Serial::run`].
pub(crate) struct Serial<S: 'static> {
    /// Thread name and the subject of error messages, e.g. "Calendar".
    name: &'static str,
    init: fn() -> S,
    timeout: Duration,
    worker: Mutex<Option<Worker<S>>>,
}

impl<S: 'static> Serial<S> {
    pub(crate) const fn new(name: &'static str, init: fn() -> S, timeout: Duration) -> Self {
        Self { name, init, timeout, worker: Mutex::new(None) }
    }

    /// Whether the owning thread has been started.
    #[cfg(test)]
    pub(crate) fn started(&self) -> bool {
        self.worker.lock().map(|slot| slot.is_some()).unwrap_or(true)
    }

    fn not_responding(&self) -> PlatformError {
        PlatformError::Failed(format!("{} is not responding. Retrying automatically.", self.name))
    }

    fn failed(&self) -> PlatformError {
        PlatformError::Failed(format!("{} could not be read.", self.name))
    }

    fn spawn(&self) -> Result<Worker<S>> {
        let (jobs, queue) = mpsc::channel::<Job<S>>();
        let pending = Arc::new(AtomicUsize::new(0));
        let finished = Arc::clone(&pending);
        let (init, name) = (self.init, self.name);
        std::thread::Builder::new()
            .name(format!("att-{}", name.to_lowercase()))
            .spawn(move || {
                let state = autoreleasepool(|_| init());
                for job in queue {
                    if catch_unwind(AssertUnwindSafe(|| autoreleasepool(|_| job(&state)))).is_err()
                    {
                        tracing::error!(target: "att_platform::macos", "{name} job panicked");
                    }
                    finished.fetch_sub(1, Ordering::SeqCst);
                }
            })
            .map_err(|error| PlatformError::Failed(format!("{name} could not start ({error}).")))?;
        Ok(Worker { jobs, pending })
    }

    /// Runs `job` on the owning thread and waits at most the configured timeout for its result.
    pub(crate) fn run<T: Send + 'static>(
        &self,
        job: impl FnOnce(&S) -> T + Send + 'static,
    ) -> Result<T> {
        let receiver = {
            let mut slot = self.worker.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let worker = match slot.take() {
                Some(worker) => worker,
                None => self.spawn()?,
            };
            if worker.pending.load(Ordering::SeqCst) >= MAX_PENDING {
                *slot = Some(worker);
                return Err(self.not_responding());
            }
            let (sender, receiver) = mpsc::sync_channel(1);
            worker.pending.fetch_add(1, Ordering::SeqCst);
            let sent = worker.jobs.send(Box::new(move |state: &S| {
                let _ = sender.send(job(state));
            }));
            if sent.is_err() {
                // The thread is gone; the next call starts a new one.
                return Err(self.failed());
            }
            *slot = Some(worker);
            receiver
        };
        match receiver.recv_timeout(self.timeout) {
            Ok(value) => Ok(value),
            Err(RecvTimeoutError::Timeout) => Err(self.not_responding()),
            // The job panicked.
            Err(RecvTimeoutError::Disconnected) => Err(self.failed()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Instant;

    fn serial(timeout_ms: u64) -> Serial<thread::ThreadId> {
        Serial::new("Test", || thread::current().id(), Duration::from_millis(timeout_ms))
    }

    #[test]
    fn jobs_run_in_order_on_the_owning_thread() {
        let serial = serial(2_000);
        let owner = serial.run(|owner| *owner).expect("first job");
        assert_ne!(owner, thread::current().id());
        let order: Vec<u32> = (0..5).map(|n| serial.run(move |_| n).expect("job")).collect();
        assert_eq!(order, [0, 1, 2, 3, 4]);
        assert_eq!(serial.run(|_| thread::current().id()).expect("same thread"), owner);
    }

    #[test]
    fn slow_jobs_time_out_and_a_full_queue_fails_fast() {
        // Wide margins: a busy CI runner can stall a thread for a few hundred milliseconds.
        let serial = serial(200);
        let started = Instant::now();
        let error = serial.run(|_| thread::sleep(Duration::from_secs(2))).expect_err("slow");
        assert_eq!(error.to_string(), "Test is not responding. Retrying automatically.");
        assert!(started.elapsed() < Duration::from_millis(1_000), "the caller stops waiting");
        for _ in 0..3 {
            assert!(serial.run(|_| ()).is_err(), "queued behind the slow job");
        }
        let failing = Instant::now();
        assert!(serial.run(|_| ()).is_err(), "four jobs pending");
        assert!(failing.elapsed() < Duration::from_millis(150), "fails without waiting");
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match serial.run(|_| 7) {
                Ok(value) => break assert_eq!(value, 7),
                Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
                Err(error) => panic!("the queue never drained: {error}"),
            }
        }
    }

    #[test]
    fn a_panicking_job_does_not_stop_the_thread() {
        let serial = serial(2_000);
        let error = serial.run(|_| -> u8 { panic!("boom") }).expect_err("panic");
        assert_eq!(error.to_string(), "Test could not be read.");
        assert_eq!(serial.run(|_| 1).expect("still running"), 1);
    }
}

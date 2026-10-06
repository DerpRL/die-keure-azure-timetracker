//! Emits only the view slices whose JSON changed since the last emission.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// One changed slice: `name` and its new JSON value.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SliceUpdate {
    pub name: &'static str,
    pub value: serde_json::Value,
}

pub type SliceSink = Arc<dyn Fn(Vec<SliceUpdate>) + Send + Sync>;

#[derive(Default)]
pub struct Publisher {
    last: Mutex<HashMap<&'static str, [u8; 32]>>,
    sink: Mutex<Option<SliceSink>>,
}

impl Publisher {
    pub fn set_sink(&self, sink: SliceSink) {
        *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(sink);
        // A new subscriber needs every slice again.
        self.last.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    /// Compares each slice with the last emitted version and sends the changed ones in one batch.
    /// Returns the changed slice names.
    pub fn publish(&self, slices: Vec<(&'static str, serde_json::Value)>) -> Vec<&'static str> {
        let mut changed = Vec::new();
        {
            let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
            for (name, value) in slices {
                let text = serde_json::to_string(&value).unwrap_or_default();
                let hash: [u8; 32] = Sha256::digest(text.as_bytes()).into();
                if last.get(name) != Some(&hash) {
                    last.insert(name, hash);
                    changed.push(SliceUpdate { name, value });
                }
            }
        }
        let names = changed.iter().map(|u| u.name).collect();
        if !changed.is_empty() {
            let sink = self.sink.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if let Some(sink) = sink {
                sink(changed);
            }
        }
        names
    }

    /// Forgets what was sent, so the next publish sends everything.
    pub fn reset(&self) {
        self.last.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_changed_slices_are_sent() {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let publisher = Publisher::default();
        let sink_sent = sent.clone();
        publisher.set_sink(Arc::new(move |updates: Vec<SliceUpdate>| {
            sink_sent.lock().unwrap().push(updates.iter().map(|u| u.name).collect::<Vec<_>>());
        }));
        assert_eq!(publisher.publish(vec![("a", json!(1)), ("b", json!(2))]), ["a", "b"]);
        assert!(publisher.publish(vec![("a", json!(1)), ("b", json!(2))]).is_empty());
        assert_eq!(publisher.publish(vec![("a", json!(1)), ("b", json!(3))]), ["b"]);
        publisher.reset();
        assert_eq!(publisher.publish(vec![("a", json!(1))]), ["a"]);
        assert_eq!(sent.lock().unwrap().len(), 3, "no empty batches");
    }
}

//! Meeting-ended prompts bound to a confirmed timer. Ported from MicrophoneTrackingEnd.swift.

use std::collections::{BTreeMap, BTreeSet};

use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::microphone::{MicrophoneApp, MicrophoneOwner, MicrophoneSession};
use crate::model::TrackingState;

/// A microphone session observed while a confirmed timer was running.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneTrackingLink {
    #[serde(alias = "sessionID")]
    pub session_id: String,
    #[serde(alias = "appID")]
    pub app_id: String,
    pub app_name: String,
    #[serde(with = "crate::time::flex_date")]
    pub started: Timestamp,
    pub workspace: String,
    pub tracking_identity: String,
}

impl MicrophoneTrackingLink {
    pub fn new(session: &MicrophoneSession, workspace: &str, tracking_identity: &str) -> Self {
        Self {
            session_id: session.id.clone(),
            app_id: session.owner.id.clone(),
            app_name: session.owner.name.clone(),
            started: session.started,
            workspace: workspace.to_string(),
            tracking_identity: tracking_identity.to_string(),
        }
    }

    pub fn session(&self) -> MicrophoneSession {
        MicrophoneSession::new(
            self.session_id.clone(),
            MicrophoneOwner::new(self.app_id.clone(), self.app_name.clone()),
            self.started,
        )
    }
}

/// "Has your meeting finished?" for the timer that was running during the call.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneEndPrompt {
    #[serde(default = "uuid::Uuid::new_v4")]
    pub id: Uuid,
    pub workspace: String,
    pub tracking_identity: String,
    pub app_names: Vec<String>,
    #[serde(with = "crate::time::flex_date")]
    pub ended_at: Timestamp,
    #[serde(default)]
    pub notified: bool,
}

impl MicrophoneEndPrompt {
    /// Still about the running timer it was created for, in the same workspace.
    pub fn is_valid(&self, state: Option<&TrackingState>, workspace: &str) -> bool {
        self.workspace == workspace
            && state
                .is_some_and(|state| state.running() && state.identity() == self.tracking_identity)
    }
}

/// One microphone poll as seen by [`MicrophoneTrackingMonitor::observe`].
#[derive(Clone, Copy, Debug)]
pub struct MicrophoneEndObservation<'a> {
    /// Sessions the meeting engine currently latches.
    pub sessions: &'a [MicrophoneSession],
    /// Watched apps using input in this sample.
    pub input_app_ids: &'a BTreeSet<String>,
    /// Sessions the engine ended after its absence debounce.
    pub ended: &'a BTreeSet<String>,
    pub state: Option<&'a TrackingState>,
    pub workspace: &'a str,
    /// The microphone sample is recent and succeeded.
    pub fresh: bool,
    /// The tracking state was confirmed by 7pace.
    pub confirmed: bool,
    pub now: Timestamp,
}

/// Binds confirmed remote tracking to observed input use, independently of a previous ticket.
/// Ended sessions must come from the debounced microphone engine, never a missing or failed
/// sample. Persisted as `microphoneTracking` (`{links, pending}`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MicrophoneTrackingMonitor {
    /// Session id → link.
    links: BTreeMap<String, MicrophoneTrackingLink>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending: Option<MicrophoneEndPrompt>,
}

impl MicrophoneTrackingMonitor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn links(&self) -> &BTreeMap<String, MicrophoneTrackingLink> {
        &self.links
    }

    pub fn pending(&self) -> Option<&MicrophoneEndPrompt> {
        self.pending.as_ref()
    }

    pub fn restore(&mut self, link: MicrophoneTrackingLink) {
        self.links.insert(link.session_id.clone(), link);
    }

    /// Drops links of other workspaces and of app categories that are no longer watched.
    pub fn restrict(&mut self, apps: &BTreeSet<MicrophoneApp>, workspace: &str) {
        self.links.retain(|_, link| {
            link.workspace == workspace && apps.contains(&MicrophoneApp::classify(&link.app_id))
        });
        if self.pending.as_ref().map(|p| p.workspace.as_str()) != Some(workspace) {
            self.pending = None;
        }
    }

    pub fn reset(&mut self) {
        self.links.clear();
        self.pending = None;
    }

    pub fn dismiss(&mut self) {
        self.pending = None;
    }

    pub fn mark_notified(&mut self) {
        if let Some(pending) = &mut self.pending {
            pending.notified = true;
        }
    }

    /// Keeps only links bound to the running timer in this workspace, and only a valid prompt.
    pub fn reconcile(&mut self, state: Option<&TrackingState>, workspace: &str) {
        let running = state.filter(|state| state.running()).map(TrackingState::identity);
        self.links.retain(|_, link| {
            link.workspace == workspace
                && running.as_deref() == Some(link.tracking_identity.as_str())
        });
        if self.pending.as_ref().is_some_and(|pending| !pending.is_valid(state, workspace)) {
            self.pending = None;
        }
    }

    /// Acts only on fresh microphone samples and confirmed tracking. Input in use binds the
    /// running timer and clears any prompt; once every watched app finished its absence
    /// debounce, ended sessions bound to the timer produce one prompt.
    pub fn observe(&mut self, observation: &MicrophoneEndObservation<'_>) {
        let o = observation;
        if !o.fresh || !o.confirmed {
            return;
        }
        self.reconcile(o.state, o.workspace);
        let Some(state) = o.state.filter(|state| state.running()) else { return };
        if o.workspace.is_empty() {
            return;
        }
        let identity = state.identity();
        // A latched session survives brief muting. Only bind a new timer while input is
        // actually observed.
        for session in o.sessions.iter().filter(|s| o.input_app_ids.contains(&s.owner.id)) {
            let link = MicrophoneTrackingLink::new(session, o.workspace, &identity);
            self.links.insert(session.id.clone(), link);
        }
        if !o.input_app_ids.is_empty() {
            self.pending = None;
            self.links.retain(|id, _| !o.ended.contains(id));
            return;
        }
        // Wait until all watched apps have completed their absence debounce.
        if !o.sessions.is_empty() {
            return;
        }
        let completed: Vec<&MicrophoneTrackingLink> =
            self.links.values().filter(|link| o.ended.contains(&link.session_id)).collect();
        if completed.is_empty() {
            return;
        }
        let ids: Vec<String> = completed.iter().map(|link| link.session_id.clone()).collect();
        if self.pending.is_none() {
            let names: BTreeSet<String> =
                completed.iter().map(|link| link.app_name.clone()).collect();
            self.pending = Some(MicrophoneEndPrompt {
                id: Uuid::new_v4(),
                workspace: o.workspace.to_string(),
                tracking_identity: identity,
                app_names: names.into_iter().collect(),
                ended_at: o.now,
                notified: false,
            });
        }
        for id in ids {
            self.links.remove(&id);
        }
    }
}

//! Interruptions (new in 2.0). Swift called `revealSuggestion()` (open the popover and take
//! focus) wherever a prompt appeared and posted some notifications separately. The engine calls
//! [`announce`] instead, which applies the user's level for the prompt kind and quiet hours.
//!
//! Notification ids are the 1.14.x ones where Swift posted a notification (`day-review`,
//! `tracking-attention`, `work-awareness`, the branch change id, the Figma suggestion id), so a
//! later notification replaces an earlier one and resolving a prompt withdraws it. Prompts that
//! had no notification in 1.14.x get stable new ids (see the constructors below).

use jiff::Timestamp;

use att_core::Cal;
use att_core::attention::TrackingAttention;
use att_core::completion::TicketCompletionPrompt;
use att_core::config::{Interruption, PromptKind};
use att_core::figma::FigmaSuggestion;
use att_core::git::BranchChange;
use att_core::meetings::MeetingEvent;
use att_core::microphone::MicrophoneSession;
use att_core::microphone_end::MicrophoneEndPrompt;
use att_core::productivity::MeetingReturn;

use crate::engine::Engine;
use crate::nl::{tr, trf};
use crate::shell::Notification;
use crate::state::AppState;

pub(crate) const DAY_REVIEW_ID: &str = "day-review";
pub(crate) const ATTENTION_ID: &str = "tracking-attention";
pub(crate) const AWARENESS_ID: &str = "work-awareness";
pub(crate) const COMPLETION_ID: &str = "ticket-completion";
pub(crate) const MICROPHONE_END_ID: &str = "microphone-end";
pub(crate) const MEETING_RETURN_ID: &str = "meeting-return";

/// What a prompt does when it appears, decided at `now`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Decision {
    /// `Some(focus)` opens the tray panel.
    pub panel: Option<bool>,
    pub notify: bool,
}

/// The effective level: tracking attention always interrupts (7pace stops the timer when an
/// activity check goes unanswered), so `Off` counts as the default there.
pub(crate) fn level(state: &AppState, kind: PromptKind) -> Interruption {
    match state.config.interruption(kind) {
        Interruption::Off if kind == PromptKind::TrackingAttention => Interruption::default(),
        level => level,
    }
}

/// Quiet hours are active at `now` (they never silence tracking attention).
pub(crate) fn quiet(state: &AppState, now: Timestamp, cal: &Cal) -> bool {
    let time = cal.civil(now);
    let minute = u16::try_from(i32::from(time.hour()) * 60 + i32::from(time.minute())).unwrap_or(0);
    state.config.quiet_hours.contains(minute)
}

/// `Off` → nothing; `NotifyOnly` → a notification; `OpenPanel` → the panel without focus, plus
/// a notification while the main window is hidden; `OpenAndFocus` → the panel with focus.
/// Notifications need `notificationsEnabled` and are never sent in preview. `panel_allowed`
/// false (Swift skipped the reveal while busy or in a flow) leaves only the notification.
pub(crate) fn decide(
    state: &AppState,
    kind: PromptKind,
    now: Timestamp,
    cal: &Cal,
    preview: bool,
    panel_allowed: bool,
) -> Decision {
    let nothing = Decision { panel: None, notify: false };
    if kind != PromptKind::TrackingAttention && quiet(state, now, cal) {
        return nothing;
    }
    let notifications = state.config.notifications_enabled && !preview;
    let window_hidden = state.visible_page.is_none();
    let level = match level(state, kind) {
        Interruption::OpenPanel | Interruption::OpenAndFocus if !panel_allowed => {
            Interruption::NotifyOnly
        }
        level => level,
    };
    match level {
        Interruption::Off => nothing,
        Interruption::NotifyOnly => Decision { panel: None, notify: notifications },
        Interruption::OpenPanel => {
            Decision { panel: Some(false), notify: notifications && window_hidden }
        }
        Interruption::OpenAndFocus => Decision { panel: Some(true), notify: false },
    }
}

/// Shows a new prompt as the user configured (Swift `revealSuggestion()` + notification).
pub(crate) fn announce(
    engine: &Engine,
    kind: PromptKind,
    notification: Option<Notification>,
    panel_allowed: bool,
) {
    let now = engine.now();
    let cal = engine.cal();
    let preview = engine.preview();
    let decision = engine.read(|state| decide(state, kind, now, &cal, preview, panel_allowed));
    let shell = &engine.services().shell;
    if let Some(focus) = decision.panel {
        shell.show_panel(focus);
    }
    if decision.notify
        && let Some(notification) = notification
    {
        shell.notify(&notification);
    }
}

fn notification(
    id: impl Into<String>,
    title: impl Into<String>,
    body: impl Into<String>,
) -> Notification {
    Notification { id: id.into(), title: title.into(), body: body.into() }
}

/// Swift `NotificationService.post(_:running:)`.
pub(crate) fn branch(change: &BranchChange, running: bool) -> Notification {
    let place = format!("{} · {}", change.repository_name, change.branch);
    if change.suggests_break() {
        return notification(
            change.id.to_string(),
            if running {
                tr("Pause or stop your timer?")
            } else {
                tr("No ticket tracking suggested")
            },
            format!(
                "{place}\n{}",
                tr("Develop and long-feature branches suggest a pause or stop.")
            ),
        );
    }
    let detail = match change.ticket_id {
        Some(id) => format!(
            "\n{}",
            trf("Switch to Azure ticket #{id}, or keep your current tracking.", &[("id", &id)])
        ),
        None => format!("\n{}", tr("Choose an Azure ticket in the app.")),
    };
    notification(
        change.id.to_string(),
        if running { tr("New branch. Keep your timer?") } else { tr("Ready to start tracking?") },
        format!("{place}{detail}"),
    )
}

/// Swift `NotificationService.postFigma(_:ticketTitle:)`.
pub(crate) fn figma(proposal: &FigmaSuggestion, ticket_title: Option<&str>) -> Notification {
    let detail = match proposal.ticket_id {
        Some(id) => format!("\n#{id} · {}", ticket_title.unwrap_or(tr("Azure ticket"))),
        None => {
            format!("\n{}", tr("Track Design with the file name as the comment. No ticket needed."))
        }
    };
    notification(
        proposal.id.to_string(),
        tr("Figma file active"),
        format!("{}{detail}", proposal.name),
    )
}

/// Swift `NotificationService.postDayReview()`.
pub(crate) fn day_review() -> Notification {
    notification(
        DAY_REVIEW_ID,
        tr("Time to review your day"),
        tr("Check your tracked time and current timer before finishing."),
    )
}

/// Swift `NotificationService.postTrackingAttention(_:)`.
pub(crate) fn attention(prompt: &TrackingAttention) -> Notification {
    let ticket = prompt.ticket_id.map(|id| format!("#{id} · ")).unwrap_or_default();
    notification(
        ATTENTION_ID,
        prompt.heading(),
        format!("{ticket}{}\n{}", prompt.title, prompt.detail()),
    )
}

/// Swift `checkWorkAwareness` (idle).
pub(crate) fn idle() -> Notification {
    notification(
        AWARENESS_ID,
        tr("Review time away"),
        tr("Keep the recorded time, or pause and review the detected idle interval."),
    )
}

/// Swift `checkWorkAwareness` (forgotten timer).
pub(crate) fn forgotten() -> Notification {
    notification(
        AWARENESS_ID,
        tr("Working without a timer?"),
        tr("Choose a ticket to start tracking, snooze, or ignore today."),
    )
}

/// New in 2.0 (1.14.x only opened the panel), with the prompt card's texts.
pub(crate) fn meeting(event: &MeetingEvent, ticket: Option<i64>) -> Notification {
    let detail = match (ticket, event.ticket_id) {
        (Some(id), Some(_)) => trf("Linked ticket #{id}", &[("id", &id)]),
        (Some(id), None) => trf("Default meeting ticket #{id}", &[("id", &id)]),
        (None, _) => tr("No ticket needed. The meeting title becomes the comment.").to_string(),
    };
    notification(meeting_id(&event.id), tr("Meeting started"), format!("{}\n{detail}", event.title))
}

pub(crate) fn meeting_id(occurrence: &str) -> String {
    format!("meeting:{occurrence}")
}

/// New in 2.0, with the prompt card's texts.
pub(crate) fn microphone(session: &MicrophoneSession) -> Notification {
    notification(
        microphone_id(&session.id),
        tr("Microphone in use · possible meeting"),
        format!(
            "{}\n{}",
            session.owner.name,
            tr("Track a meeting, or a daily standup with the Standup activity.")
        ),
    )
}

pub(crate) fn microphone_id(session: &str) -> String {
    format!("microphone:{session}")
}

/// New in 2.0, with the prompt card's texts.
pub(crate) fn microphone_end(prompt: &MicrophoneEndPrompt) -> Notification {
    notification(
        MICROPHONE_END_ID,
        tr("Microphone use stopped"),
        trf(
            "{apps} has not used the microphone for at least a minute. Has your meeting finished?",
            &[("apps", &prompt.app_names.join(", "))],
        ),
    )
}

/// New in 2.0, with the prompt card's texts.
pub(crate) fn meeting_return(plan: &MeetingReturn, title: Option<&str>) -> Notification {
    let heading = if plan.microphone_session_id.is_none() {
        tr("Meeting ended")
    } else {
        tr("Microphone use stopped")
    };
    let question = trf("Return to #{id}?", &[("id", &plan.ticket_id)]);
    let body = match title {
        Some(title) => format!("{question}\n{title}"),
        None => question,
    };
    notification(MEETING_RETURN_ID, heading, body)
}

/// New in 2.0, with the prompt card's texts.
pub(crate) fn completion(prompt: &TicketCompletionPrompt) -> Notification {
    notification(
        COMPLETION_ID,
        tr("Tracked ticket completed"),
        format!(
            "#{} · {}\n{}",
            prompt.ticket_id,
            prompt.title,
            trf(
                "Azure status: {status}. Your timer is still running.",
                &[("status", &prompt.workflow_state)]
            )
        ),
    )
}

#[cfg(test)]
mod tests {
    use att_core::i18n::{Language, with_language};

    use super::*;

    #[test]
    fn prompts_and_notifications_follow_the_interface_language() {
        let english = day_review();
        assert_eq!(english.title, "Time to review your day");
        with_language(Language::Nl, || {
            let dutch = day_review();
            assert_eq!(dutch.id, DAY_REVIEW_ID, "ids stay stable");
            assert_eq!(dutch.title, "Tijd om je dag te controleren");
            assert_eq!(
                dutch.body,
                "Controleer je geregistreerde tijd en je huidige timer voor je afsluit."
            );
            assert_eq!(idle().title, "Afwezigheid controleren");
        });
    }
}

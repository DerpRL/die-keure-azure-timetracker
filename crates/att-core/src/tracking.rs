//! The guarded switch and stop transactions. Ported from `TrackingTransaction` in API.swift.
//!
//! Owner during the port: tracking and Git.
//!
//! A switch is stop → verified idle → start. Every step works from a fresh read or the server's
//! confirmation, and no write is ever retried: when a response is lost (timeout, cancellation)
//! the caller must reconcile with a read before offering the action again.

use crate::attention::TrackingAttention;
use crate::error::{AppError, Result};
use crate::model::{Track, TrackingState};
use crate::service::TrackingService;
use crate::text::NonEmpty;

/// The default `validate_context` (Swift `{}`): nothing outside 7pace needs rechecking.
pub async fn no_context() -> Result<()> {
    Ok(())
}

/// Switches the remote timer to `ticket_id` (or to a ticket-free `remark`) if 7pace still shows
/// the session the user saw (`expected_identity`, and `expected_attention` when the action comes
/// from an attention prompt).
///
/// `validate_context` rechecks the local reason for the switch (a Figma file, a meeting, …) and
/// runs twice: before any write, and again after the stop, right before the start. Steps:
///
/// 1. reject a request with neither a valid ticket nor a comment, before any network call;
/// 2. read the current state; a different identity or attention prompt is
///    [`AppError::RemoteChanged`];
/// 3. validate the context;
/// 4. return the current state unchanged when it already runs this ticket (and this activity and
///    comment, when given);
/// 5. refuse when 7pace forbids starting, before stopping anything;
/// 6. stop a running timer and require the confirmed idle state;
/// 7. validate the context again, start, and require the requested ticket, activity and comment.
pub async fn switch_to<S, V, F>(
    ticket_id: Option<i64>,
    expected_identity: &str,
    activity_type: Option<&str>,
    remark: Option<&str>,
    expected_attention: Option<&TrackingAttention>,
    service: &S,
    validate_context: V,
) -> Result<TrackingState>
where
    S: TrackingService + ?Sized,
    V: Fn() -> F,
    F: Future<Output = Result<()>>,
{
    let valid_request = match ticket_id {
        Some(id) => (1..=i32::MAX as i64).contains(&id),
        None => remark.non_empty().is_some(),
    };
    if !valid_request {
        return Err(AppError::message("Choose a valid ticket or supply a tracking comment."));
    }
    let actual = service.current().await?.checked()?;
    if actual.identity() != expected_identity {
        return Err(AppError::RemoteChanged);
    }
    if let Some(expected) = expected_attention
        && TrackingAttention::from_state(&actual).is_none_or(|current| current.id != expected.id)
    {
        return Err(AppError::RemoteChanged);
    }
    validate_context().await?;
    let track = actual.track.as_ref();
    if actual.running()
        && track.and_then(Track::ticket_id) == ticket_id
        && activity_type.is_none_or(|activity| activity_of(track) == Some(activity))
        && remark.is_none_or(|remark| remark_of(track) == Some(remark))
    {
        return Ok(actual);
    }
    // Checked before stopping: a forbidden start must not end the current timer.
    if actual.track_settings.as_ref().and_then(|settings| settings.is_tracking_start_allowed)
        == Some(false)
    {
        return Err(AppError::message(
            "7pace does not currently allow starting a timer. Check your tracking settings.",
        ));
    }
    if actual.running() {
        let stopped = service.stop().await?.checked()?;
        if stopped.running() {
            return Err(AppError::message(
                "7pace did not confirm that the current timer stopped. The new timer was not started.",
            ));
        }
    }
    validate_context().await?;
    let started = service.start(ticket_id, activity_type, remark).await?.checked()?;
    let track = started.track.as_ref();
    if !started.running() || track.and_then(Track::ticket_id) != ticket_id {
        return Err(AppError::message(
            "7pace did not confirm the requested timer. Refresh before trying again.",
        ));
    }
    if let Some(activity) = activity_type
        && activity_of(track) != Some(activity)
    {
        return Err(AppError::message(
            "7pace did not confirm the selected activity type. Refresh and check the running timer before trying again.",
        ));
    }
    if let Some(remark) = remark
        && remark_of(track) != Some(remark)
    {
        return Err(AppError::message(
            "7pace did not confirm the tracking comment. Refresh and check the running timer before trying again.",
        ));
    }
    Ok(started)
}

/// Stops the remote timer if 7pace still shows `expected_identity`. An idle timer is returned
/// unchanged without a write.
pub async fn stop<S>(expected_identity: &str, service: &S) -> Result<TrackingState>
where
    S: TrackingService + ?Sized,
{
    let actual = service.current().await?.checked()?;
    if actual.identity() != expected_identity {
        return Err(AppError::RemoteChanged);
    }
    if !actual.running() {
        return Ok(actual);
    }
    let stopped = service.stop().await?.checked()?;
    if stopped.running() {
        return Err(AppError::message("7pace did not confirm that tracking stopped."));
    }
    Ok(stopped)
}

fn activity_of(track: Option<&Track>) -> Option<&str> {
    track.and_then(|track| track.activity_type_id.as_deref())
}

fn remark_of(track: Option<&Track>) -> Option<&str> {
    track.and_then(|track| track.remark.as_deref())
}

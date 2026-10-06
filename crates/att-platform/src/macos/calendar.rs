//! EventKit calendars and events, ported from `CalendarService` in
//! `Sources/AzureTimetracker/LocalServices.swift` (1.14.x).
//!
//! - Access is "authorized" only for `EKAuthorizationStatus.fullAccess`; write-only access cannot
//!   read events and maps to [`CalendarAccess::Denied`], as 1.14.x treated it as off.
//! - [`CalendarSource::request_access`] calls `requestFullAccessToEventsWithCompletion:` every
//!   time, like Swift; EventKit only prompts while the status is not determined.
//! - [`CalendarSource::calendars`] lists `calendars(for: .event)` sorted by title (Swift `<`).
//! - [`CalendarSource::events`] filters those calendars by identifier (all when the filter is
//!   empty, none when nothing matches) and runs `predicateForEvents(withStart:end:calendars:)`.
//!   Results keep EventKit's order and include cancelled, declined and free events; consumers
//!   filter and sort exactly as the Swift agenda and meeting engine did.
//! - [`CalendarEvent::occurrence_id`] is the 1.14.x meeting key, byte for byte:
//!   `SHA256("<calendarIdentifier>|<calendarItemIdentifier>|<startDate.timeIntervalSince1970>")`
//!   in lower-case hex, with the start printed the way Swift prints a `Double`. The migrated
//!   "already prompted" ledger (`meetingReminders`) therefore keeps matching.
//! - Without full access, `calendars` and `events` return empty lists, as the Swift service did.
//!
//! EventKit objects are not thread-safe, so one `EKEventStore` lives on a dedicated thread and
//! every query runs there. Callers wait at most [`TIMEOUT`].

use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use block2::RcBlock;
use jiff::Timestamp;
use objc2::msg_send;
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::Bool;
use objc2_app_kit::NSWorkspace;
use objc2_core_graphics::{CGColor, CGColorRenderingIntent, CGColorSpace, kCGColorSpaceSRGB};
use objc2_event_kit::{
    EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventAvailability, EKEventStatus,
    EKEventStore, EKParticipantStatus,
};
use objc2_foundation::{NSArray, NSDate, NSError, NSString, NSURL};

use super::serial::Serial;
use super::swift::{double_description, sha256_hex, string_cmp};
use crate::{
    CalendarAccess, CalendarEvent, CalendarInfo, CalendarSource, EventStatus, PlatformError, Result,
};

/// Longest a caller waits for the EventKit thread.
pub(crate) const TIMEOUT: Duration = Duration::from_secs(2);
/// Swift `Date.timeIntervalBetween1970AndReferenceDate`.
const REFERENCE_DATE_SINCE_1970: f64 = 978_307_200.0;
const CALENDAR_APP: &str = "/System/Applications/Calendar.app";

/// EventKit-backed [`CalendarSource`]. Cheap to create: the event store and its thread start on
/// the first query that needs them, never before full access is granted.
pub struct EventKitCalendar {
    /// One long-lived store, as Apple recommends. EventKit objects never leave its thread; jobs
    /// convert them to plain Rust values before returning.
    store: Serial<Retained<EKEventStore>>,
}

/// `[EKEventStore new]`; creating a store never prompts.
fn new_store() -> Retained<EKEventStore> {
    // SAFETY: `+[EKEventStore new]` has no preconditions.
    unsafe { EKEventStore::new() }
}

impl EventKitCalendar {
    pub fn new() -> Self {
        Self { store: Serial::new("Calendar", new_store, TIMEOUT) }
    }

    fn authorized(&self) -> bool {
        self.access() == CalendarAccess::Authorized
    }

    /// Runs `job` with the event store on the EventKit thread and waits up to [`TIMEOUT`].
    fn run<T: Send + 'static>(
        &self,
        job: impl FnOnce(&EKEventStore) -> T + Send + 'static,
    ) -> Result<T> {
        self.store.run(move |store| job(store))
    }

    /// Whether the EventKit thread and store exist yet (tests).
    #[cfg(test)]
    fn started(&self) -> bool {
        self.store.started()
    }
}

impl Default for EventKitCalendar {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl CalendarSource for EventKitCalendar {
    fn access(&self) -> CalendarAccess {
        // SAFETY: class method without preconditions; it never prompts.
        map_status(unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) })
    }

    async fn request_access(&self) -> Result<CalendarAccess> {
        let (sender, receiver) = oneshot::channel::<std::result::Result<bool, String>>();
        self.run(move |store| {
            let sender = Mutex::new(Some(sender));
            let completion: RcBlock<dyn Fn(Bool, *mut NSError)> =
                RcBlock::new(move |granted: Bool, error: *mut NSError| {
                    // SAFETY: EventKit passes either NULL or a valid NSError.
                    let result = match unsafe { error.as_ref() } {
                        Some(error) => Err(error.localizedDescription().to_string()),
                        None => Ok(granted.as_bool()),
                    };
                    let sender =
                        sender.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
                    if let Some(sender) = sender {
                        sender.send(result);
                    }
                });
            // SAFETY: the block matches the completion handler signature; EventKit copies it.
            unsafe { store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&completion)) };
        })?;
        match receiver.await {
            Some(Ok(true)) => Ok(CalendarAccess::Authorized),
            Some(Ok(false)) => Ok(match self.access() {
                CalendarAccess::Authorized => CalendarAccess::Denied,
                other => other,
            }),
            Some(Err(message)) => Err(PlatformError::Failed(message)),
            None => Err(PlatformError::Failed("Calendar access could not be requested.".into())),
        }
    }

    fn calendars(&self) -> Result<Vec<CalendarInfo>> {
        if !self.authorized() {
            return Ok(Vec::new());
        }
        self.run(|store| {
            sorted_calendars(store).iter().map(|calendar| calendar_info(calendar)).collect()
        })
    }

    fn events(
        &self,
        from: Timestamp,
        to: Timestamp,
        calendar_ids: &[String],
    ) -> Result<Vec<CalendarEvent>> {
        if !self.authorized() {
            return Ok(Vec::new());
        }
        let ids = calendar_ids.to_vec();
        let (from, to) = (att_core::time::secs(from), att_core::time::secs(to));
        self.run(move |store| read_events(store, from, to, &ids))
    }

    fn open_calendar_app(&self) -> Result<()> {
        autoreleasepool(|_| {
            let url = NSURL::fileURLWithPath(&NSString::from_str(CALENDAR_APP));
            if NSWorkspace::sharedWorkspace().openURL(&url) {
                Ok(())
            } else {
                Err(PlatformError::Failed("Calendar could not be opened.".into()))
            }
        })
    }
}

/// `EKEventStore.authorizationStatus(for: .event)` → [`CalendarAccess`].
pub(crate) fn map_status(status: EKAuthorizationStatus) -> CalendarAccess {
    if status == EKAuthorizationStatus::FullAccess {
        CalendarAccess::Authorized
    } else if status == EKAuthorizationStatus::NotDetermined {
        CalendarAccess::NotDetermined
    } else if status == EKAuthorizationStatus::Restricted {
        CalendarAccess::Restricted
    } else {
        // `.denied`, `.writeOnly` and future values: events cannot be read.
        CalendarAccess::Denied
    }
}

/// The 1.14.x meeting occurrence key (`MeetingEvent.id`).
pub(crate) fn occurrence_id(calendar_id: &str, item_id: &str, start_since_1970: f64) -> String {
    sha256_hex(&format!("{calendar_id}|{item_id}|{}", double_description(start_since_1970)))
}

/// `#rrggbb` from sRGB components in `0...1`, rounded to the nearest byte.
pub(crate) fn hex_color(red: f64, green: f64, blue: f64) -> String {
    let byte = |component: f64| {
        if component.is_finite() { (component.clamp(0.0, 1.0) * 255.0).round() as u8 } else { 0 }
    };
    format!("#{:02x}{:02x}{:02x}", byte(red), byte(green), byte(blue))
}

fn map_event_status(status: EKEventStatus) -> EventStatus {
    if status == EKEventStatus::Confirmed {
        EventStatus::Confirmed
    } else if status == EKEventStatus::Tentative {
        EventStatus::Tentative
    } else if status == EKEventStatus::Canceled {
        EventStatus::Canceled
    } else {
        EventStatus::None
    }
}

fn string(value: Option<Retained<NSString>>) -> Option<String> {
    value.map(|text| text.to_string())
}

fn calendar_identifier(calendar: &EKCalendar) -> Option<String> {
    // Read through `msg_send!` with an optional result: the binding's non-null annotation would
    // panic if EventKit ever returned nil.
    // SAFETY: `calendarIdentifier` is an NSString property of EKCalendar.
    string(unsafe { msg_send![calendar, calendarIdentifier] })
}

fn calendar_title(calendar: &EKCalendar) -> String {
    // SAFETY: `title` is an NSString property of EKCalendar.
    string(unsafe { msg_send![calendar, title] }).unwrap_or_default()
}

/// `store.calendars(for: .event).sorted { $0.title < $1.title }`.
fn sorted_calendars(store: &EKEventStore) -> Vec<Retained<EKCalendar>> {
    // SAFETY: `calendarsForEntityType:` returns an array of EKCalendar.
    let calendars: Option<Retained<NSArray<EKCalendar>>> =
        unsafe { msg_send![store, calendarsForEntityType: EKEntityType::Event] };
    let mut calendars: Vec<(String, Retained<EKCalendar>)> = calendars
        .map(|calendars| calendars.to_vec())
        .unwrap_or_default()
        .into_iter()
        .map(|calendar| (calendar_title(&calendar), calendar))
        .collect();
    calendars.sort_by(|a, b| string_cmp(&a.0, &b.0));
    calendars.into_iter().map(|(_, calendar)| calendar).collect()
}

fn calendar_info(calendar: &EKCalendar) -> CalendarInfo {
    // SAFETY: plain property reads on an EKCalendar owned by this thread.
    let source = unsafe { calendar.source() }.and_then(|source| {
        // SAFETY: `title` is an NSString property of EKSource.
        string(unsafe { msg_send![&*source, title] })
    });
    CalendarInfo {
        id: calendar_identifier(calendar).unwrap_or_default(),
        title: calendar_title(calendar),
        color: calendar_color(calendar),
        source,
    }
}

/// The calendar colour converted to sRGB.
fn calendar_color(calendar: &EKCalendar) -> Option<String> {
    // SAFETY: `CGColor` is a property of EKCalendar on macOS 10.15+.
    let color = unsafe { calendar.CGColor() }?;
    // SAFETY: `kCGColorSpaceSRGB` is an immutable CoreGraphics constant.
    let srgb = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))?;
    // SAFETY: valid colour and colour space; no options dictionary.
    let converted = unsafe {
        CGColor::new_copy_by_matching_to_color_space(
            Some(&srgb),
            CGColorRenderingIntent::RenderingIntentDefault,
            Some(&color),
            None,
        )
    }?;
    let count = CGColor::number_of_components(Some(&converted));
    let components = CGColor::components(Some(&converted));
    if count < 3 || components.is_null() {
        return None;
    }
    // SAFETY: CoreGraphics returns `count` components that live as long as `converted`.
    let rgb = unsafe { std::slice::from_raw_parts(components, count) };
    Some(hex_color(rgb[0], rgb[1], rgb[2]))
}

fn read_events(store: &EKEventStore, from: f64, to: f64, ids: &[String]) -> Vec<CalendarEvent> {
    let calendars = sorted_calendars(store);
    let selected: Vec<Retained<EKCalendar>> = if ids.is_empty() {
        calendars
    } else {
        calendars
            .into_iter()
            .filter(|calendar| calendar_identifier(calendar).is_some_and(|id| ids.contains(&id)))
            .collect()
    };
    if selected.is_empty() {
        return Vec::new();
    }
    let calendars = NSArray::from_retained_slice(&selected);
    let start = NSDate::dateWithTimeIntervalSince1970(from);
    let end = NSDate::dateWithTimeIntervalSince1970(to);
    // SAFETY: dates and calendars come from this store; the predicate is EventKit's own.
    let predicate = unsafe {
        store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, Some(&calendars))
    };
    // SAFETY: `eventsMatchingPredicate:` returns an array of EKEvent (nil is tolerated).
    let events: Option<Retained<NSArray<EKEvent>>> =
        unsafe { msg_send![store, eventsMatchingPredicate: &*predicate] };
    events
        .map(|events| events.iter().filter_map(|event| convert_event(&event)).collect())
        .unwrap_or_default()
}

/// Seconds since 1970 exactly as Swift computes `Date.timeIntervalSince1970`.
fn since_1970(date: &NSDate) -> f64 {
    date.timeIntervalSinceReferenceDate() + REFERENCE_DATE_SINCE_1970
}

fn convert_event(event: &EKEvent) -> Option<CalendarEvent> {
    // SAFETY (all reads below): property reads on an EKEvent owned by this thread. Non-null
    // annotated properties are read through `msg_send!` with optional results so that a nil from
    // EventKit skips the field instead of panicking.
    let start: Option<Retained<NSDate>> = unsafe { msg_send![event, startDate] };
    let end: Option<Retained<NSDate>> = unsafe { msg_send![event, endDate] };
    let (start, end) = (start?, end?);
    let (start, end) = (since_1970(&start), since_1970(&end));
    let calendar = unsafe { event.calendar() };
    let calendar_id = calendar.as_deref().and_then(calendar_identifier).unwrap_or_default();
    let item_id = string(unsafe { msg_send![event, calendarItemIdentifier] }).unwrap_or_default();
    let title = string(unsafe { msg_send![event, title] }).unwrap_or_default();
    let declined = unsafe { event.attendees() }.is_some_and(|attendees| {
        attendees.iter().any(|attendee| unsafe {
            attendee.isCurrentUser()
                && attendee.participantStatus() == EKParticipantStatus::Declined
        })
    });
    let url = unsafe { event.URL() }.and_then(|url| string(url.absoluteString()));
    Some(CalendarEvent {
        occurrence_id: occurrence_id(&calendar_id, &item_id, start),
        calendar_id,
        title,
        start: att_core::time::from_secs(start),
        end: att_core::time::from_secs(end),
        all_day: unsafe { event.isAllDay() },
        status: map_event_status(unsafe { event.status() }),
        declined,
        free: unsafe { event.availability() } == EKEventAvailability::Free,
        location: string(unsafe { event.location() }),
        notes: string(unsafe { event.notes() }),
        url,
        calendar_color: calendar.as_deref().and_then(calendar_color),
    })
}

/// A single-value channel whose receiver is a `Future`, so `request_access` can await the
/// EventKit completion handler without depending on a particular async runtime.
mod oneshot {
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex, MutexGuard};
    use std::task::{Context, Poll, Waker};

    struct State<T> {
        value: Option<T>,
        closed: bool,
        waker: Option<Waker>,
    }

    pub(super) struct Sender<T>(Arc<Mutex<State<T>>>);
    pub(super) struct Receiver<T>(Arc<Mutex<State<T>>>);

    pub(super) fn channel<T>() -> (Sender<T>, Receiver<T>) {
        let state = Arc::new(Mutex::new(State { value: None, closed: false, waker: None }));
        (Sender(Arc::clone(&state)), Receiver(state))
    }

    fn lock<T>(state: &Mutex<State<T>>) -> MutexGuard<'_, State<T>> {
        state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    impl<T> Sender<T> {
        pub(super) fn send(self, value: T) {
            lock(&self.0).value = Some(value);
        }
    }

    impl<T> Drop for Sender<T> {
        fn drop(&mut self) {
            let mut state = lock(&self.0);
            state.closed = true;
            if let Some(waker) = state.waker.take() {
                waker.wake();
            }
        }
    }

    impl<T> Future for Receiver<T> {
        /// `None` when the sender was dropped without a value.
        type Output = Option<T>;

        fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
            let mut state = lock(&self.0);
            if let Some(value) = state.value.take() {
                Poll::Ready(Some(value))
            } else if state.closed {
                Poll::Ready(None)
            } else {
                state.waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

/// Stand-ins for EventKit objects. They answer the same selectors with the same type encodings,
/// so the conversion code runs end to end without an event store (creating one, or reading real
/// calendars, has no place in a test).
#[cfg(test)]
mod fakes {
    use objc2::rc::Retained;
    use objc2::runtime::NSObject;
    use objc2::{AnyThread, DefinedClass, define_class, msg_send};
    use objc2_core_foundation::CFRetained;
    use objc2_core_graphics::CGColor;
    use objc2_event_kit::{EKEventAvailability, EKEventStatus, EKParticipantStatus};
    use objc2_foundation::{NSArray, NSDate, NSString, NSURL};

    pub(super) struct ParticipantIvars {
        pub current_user: bool,
        pub status: EKParticipantStatus,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; no Drop impl.
        #[unsafe(super(NSObject))]
        #[name = "ATTTestFakeParticipant"]
        #[ivars = ParticipantIvars]
        pub(super) struct FakeParticipant;

        impl FakeParticipant {
            #[unsafe(method(isCurrentUser))]
            fn is_current_user(&self) -> bool {
                self.ivars().current_user
            }

            #[unsafe(method(participantStatus))]
            fn participant_status(&self) -> EKParticipantStatus {
                self.ivars().status
            }
        }
    );

    pub(super) struct SourceIvars {
        pub title: Retained<NSString>,
    }

    define_class!(
        // SAFETY: as above.
        #[unsafe(super(NSObject))]
        #[name = "ATTTestFakeSource"]
        #[ivars = SourceIvars]
        pub(super) struct FakeSource;

        impl FakeSource {
            #[unsafe(method_id(title))]
            fn title(&self) -> Retained<NSString> {
                self.ivars().title.clone()
            }
        }
    );

    pub(super) struct CalendarIvars {
        pub id: Retained<NSString>,
        pub title: Retained<NSString>,
        pub source: Option<Retained<NSObject>>,
        pub color: Option<CFRetained<CGColor>>,
    }

    define_class!(
        // SAFETY: as above.
        #[unsafe(super(NSObject))]
        #[name = "ATTTestFakeCalendar"]
        #[ivars = CalendarIvars]
        pub(super) struct FakeCalendar;

        impl FakeCalendar {
            #[unsafe(method_id(calendarIdentifier))]
            fn calendar_identifier(&self) -> Retained<NSString> {
                self.ivars().id.clone()
            }

            #[unsafe(method_id(title))]
            fn title(&self) -> Retained<NSString> {
                self.ivars().title.clone()
            }

            #[unsafe(method_id(source))]
            fn source(&self) -> Option<Retained<NSObject>> {
                self.ivars().source.clone()
            }

            /// Like the real `CGColorRef CGColor` property: a +0 pointer (`^{CGColor=}`).
            #[unsafe(method(CGColor))]
            fn cg_color(&self) -> *const CGColor {
                self.ivars()
                    .color
                    .as_ref()
                    .map_or(std::ptr::null(), |color| CFRetained::as_ptr(color).as_ptr().cast_const())
            }
        }
    );

    pub(super) struct EventIvars {
        pub start: Option<Retained<NSDate>>,
        pub end: Option<Retained<NSDate>>,
        pub calendar: Option<Retained<NSObject>>,
        pub item: Retained<NSString>,
        pub title: Option<Retained<NSString>>,
        pub attendees: Option<Retained<NSArray<NSObject>>>,
        pub url: Option<Retained<NSURL>>,
        pub all_day: bool,
        pub status: EKEventStatus,
        pub availability: EKEventAvailability,
        pub location: Option<Retained<NSString>>,
        pub notes: Option<Retained<NSString>>,
    }

    define_class!(
        // SAFETY: as above.
        #[unsafe(super(NSObject))]
        #[name = "ATTTestFakeEvent"]
        #[ivars = EventIvars]
        pub(super) struct FakeEvent;

        impl FakeEvent {
            #[unsafe(method_id(startDate))]
            fn start_date(&self) -> Option<Retained<NSDate>> {
                self.ivars().start.clone()
            }

            #[unsafe(method_id(endDate))]
            fn end_date(&self) -> Option<Retained<NSDate>> {
                self.ivars().end.clone()
            }

            #[unsafe(method_id(calendar))]
            fn calendar(&self) -> Option<Retained<NSObject>> {
                self.ivars().calendar.clone()
            }

            #[unsafe(method_id(calendarItemIdentifier))]
            fn calendar_item_identifier(&self) -> Retained<NSString> {
                self.ivars().item.clone()
            }

            #[unsafe(method_id(title))]
            fn title(&self) -> Option<Retained<NSString>> {
                self.ivars().title.clone()
            }

            #[unsafe(method_id(attendees))]
            fn attendees(&self) -> Option<Retained<NSArray<NSObject>>> {
                self.ivars().attendees.clone()
            }

            #[unsafe(method_id(URL))]
            fn url(&self) -> Option<Retained<NSURL>> {
                self.ivars().url.clone()
            }

            #[unsafe(method(isAllDay))]
            fn is_all_day(&self) -> bool {
                self.ivars().all_day
            }

            #[unsafe(method(status))]
            fn status(&self) -> EKEventStatus {
                self.ivars().status
            }

            #[unsafe(method(availability))]
            fn availability(&self) -> EKEventAvailability {
                self.ivars().availability
            }

            #[unsafe(method_id(location))]
            fn location(&self) -> Option<Retained<NSString>> {
                self.ivars().location.clone()
            }

            #[unsafe(method_id(notes))]
            fn notes(&self) -> Option<Retained<NSString>> {
                self.ivars().notes.clone()
            }
        }
    );

    fn object<T: objc2::ClassType<Super = NSObject> + DefinedClass + 'static>(
        this: objc2::rc::Allocated<T>,
        ivars: T::Ivars,
    ) -> Retained<NSObject> {
        let this = this.set_ivars(ivars);
        // SAFETY: `-[NSObject init]` on a freshly allocated object.
        let this: Retained<T> = unsafe { msg_send![super(this), init] };
        Retained::into_super(this)
    }

    pub(super) fn participant(
        current_user: bool,
        status: EKParticipantStatus,
    ) -> Retained<NSObject> {
        object(FakeParticipant::alloc(), ParticipantIvars { current_user, status })
    }

    pub(super) fn source(title: &str) -> Retained<NSObject> {
        object(FakeSource::alloc(), SourceIvars { title: NSString::from_str(title) })
    }

    pub(super) fn calendar(ivars: CalendarIvars) -> Retained<NSObject> {
        object(FakeCalendar::alloc(), ivars)
    }

    pub(super) fn event(ivars: EventIvars) -> Retained<NSObject> {
        object(FakeEvent::alloc(), ivars)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn occurrence_id_matches_swift_cryptokit() {
        // `(calendarIdentifier, calendarItemIdentifier, startDate.timeIntervalSince1970 bits,
        // composed string, SHA-256)` computed by Swift 6.4 with the 1.14.x expression.
        let cases: &[(&str, &str, u64, &str, &str)] = &[
            (
                "A1B2C3D4-0000-4000-8000-000000000001",
                "E5F6A7B8-1111-4111-9111-111111111111",
                4745167682448392192,
                "A1B2C3D4-0000-4000-8000-000000000001|E5F6A7B8-1111-4111-9111-111111111111|1759737600.0",
                "d0a85b8b85368de3eb074d2b14c1f64fae6eea3fe2a75067f41e242901e98190",
            ),
            (
                "cal",
                "item",
                4745167682450489344,
                "cal|item|1759737600.5",
                "ba7475f30e887ebbe4e0229f0eb88f0779ff3d5d82ba3fca304ea81d85185c79",
            ),
            (
                "cal",
                "item",
                4745167682448910004,
                "cal|item|1759737600.123456",
                "20cbe3f8c9a5250c9c18b26c7b6a93b75ada24afeba38dd1072f257b1cdf2a9c",
            ),
            (
                "Kalender-\u{e9}",
                "\u{ef}tem:\u{df}/\u{2713}",
                13904045812855341056,
                "Kalender-\u{e9}|\u{ef}tem:\u{df}/\u{2713}|-86400.0",
                "708e598c2f862ffbed7d742518a9c120cb69e6e73624e8399afc33b4991faf3f",
            ),
            (
                "cal",
                "item",
                0,
                "cal|item|0.0",
                "f020029b2962dd02dacf150d99d2b438b853258878f1c07187ada050a502a2a7",
            ),
            (
                "cal",
                "item",
                4846369599423283200,
                "cal|item|1e+16",
                "413b34f6f4936930d138d2e6d04806480fc4740a6d62d6822e709c2151cce626",
            ),
            (
                "cal",
                "item",
                4532020583610935537,
                "cal|item|1.0013580322265625e-05",
                "b354030218aaf219f03a68e1d00dc92e817fc9c85319fca928ec4839d5b3d335",
            ),
            (
                "cal",
                "item",
                4745167682449440768,
                "cal|item|1759737600.25",
                "86af60ee1b1209b68cb22baead45cbcacd3940390edd90ba69a08f1655cf01f1",
            ),
        ];
        for (calendar, item, bits, composed, expected) in cases {
            // Swift built each value with `Date(timeIntervalSince1970:)` (stored since 2001) and
            // read it back with `timeIntervalSince1970`; an EventKit NSDate round-trips the same
            // way, which is why 1e-05 comes back as 1.0013580322265625e-05.
            let start = since_1970(&NSDate::dateWithTimeIntervalSince1970(f64::from_bits(*bits)));
            assert_eq!(
                format!("{calendar}|{item}|{}", double_description(start)),
                *composed,
                "composition for {start:e}"
            );
            assert_eq!(occurrence_id(calendar, item, start), *expected, "hash for {composed}");
        }
    }

    #[test]
    fn swift_reference_date_arithmetic_matches_since_1970() {
        // Swift stores dates since 2001 and adds 978307200 for `timeIntervalSince1970`.
        let date = NSDate::dateWithTimeIntervalSinceReferenceDate(781_430_400.25);
        assert_eq!(since_1970(&date).to_bits(), 4745167682449440768);
    }

    #[test]
    fn colour_components_round_to_the_nearest_byte() {
        assert_eq!(hex_color(1.0, 0.0, 0.0), "#ff0000");
        assert_eq!(hex_color(0.5, 0.2, 1.0 / 3.0), "#803355");
        assert_eq!(hex_color(0.996, 0.001, 0.502), "#fe0080");
        assert_eq!(hex_color(-0.2, 1.4, f64::NAN), "#00ff00", "out-of-gamut values clamp");
    }

    #[test]
    fn authorization_status_mapping() {
        let cases = [
            (0, CalendarAccess::NotDetermined),
            (1, CalendarAccess::Restricted),
            (2, CalendarAccess::Denied),
            (3, CalendarAccess::Authorized),
            (4, CalendarAccess::Denied),
            (99, CalendarAccess::Denied),
        ];
        for (raw, expected) in cases {
            assert_eq!(map_status(EKAuthorizationStatus(raw)), expected, "status {raw}");
        }
    }

    #[test]
    fn event_status_mapping() {
        assert_eq!(map_event_status(EKEventStatus(0)), EventStatus::None);
        assert_eq!(map_event_status(EKEventStatus(1)), EventStatus::Confirmed);
        assert_eq!(map_event_status(EKEventStatus(2)), EventStatus::Tentative);
        assert_eq!(map_event_status(EKEventStatus(3)), EventStatus::Canceled);
        assert_eq!(map_event_status(EKEventStatus(7)), EventStatus::None);
    }

    #[test]
    fn oneshot_delivers_value_or_reports_a_dropped_sender() {
        use std::future::Future;
        use std::pin::pin;
        use std::task::{Context, Poll, Waker};

        let mut cx = Context::from_waker(Waker::noop());
        let (sender, receiver) = oneshot::channel::<u8>();
        let mut receiver = pin!(receiver);
        assert_eq!(receiver.as_mut().poll(&mut cx), Poll::Pending);
        std::thread::spawn(move || sender.send(7)).join().expect("send");
        assert_eq!(receiver.as_mut().poll(&mut cx), Poll::Ready(Some(7)));

        let (sender, receiver) = oneshot::channel::<u8>();
        drop(sender);
        assert_eq!(pin!(receiver).poll(&mut cx), Poll::Ready(None));
    }

    #[test]
    fn access_reads_status_without_prompting() {
        // Only reads the TCC status of the responsible process; never requests access.
        let access = EventKitCalendar::new().access();
        assert_ne!(access, CalendarAccess::Unsupported);
    }

    #[test]
    fn without_full_access_nothing_is_read() {
        let calendar = EventKitCalendar::new();
        if calendar.access() == CalendarAccess::Authorized {
            // The host app has calendar access; reading personal calendars is not a test.
            return;
        }
        let now = Timestamp::now();
        assert_eq!(calendar.calendars().expect("calendars"), []);
        assert_eq!(calendar.events(now, now, &[]).expect("events"), []);
        assert!(!calendar.started(), "no event store is created without access");
    }

    /// Treats a fake as the EventKit class whose selectors it implements.
    ///
    /// # Safety
    /// `object` must answer every selector the conversion code sends to `T`.
    unsafe fn view<T>(object: &objc2::runtime::NSObject) -> &T {
        unsafe { &*(object as *const objc2::runtime::NSObject).cast::<T>() }
    }

    #[test]
    fn events_and_calendars_convert_like_1_14() {
        use fakes::*;

        autoreleasepool(|_| {
            let work = calendar(CalendarIvars {
                id: NSString::from_str("A1B2C3D4-0000-4000-8000-000000000001"),
                title: NSString::from_str("Work"),
                source: Some(source("Exchange")),
                color: Some(CGColor::new_srgb(1.0, 0.5, 0.0, 1.0)),
            });
            // SAFETY: FakeCalendar implements calendarIdentifier, title, source and CGColor.
            let info = calendar_info(unsafe { view::<EKCalendar>(&work) });
            assert_eq!(
                info,
                CalendarInfo {
                    id: "A1B2C3D4-0000-4000-8000-000000000001".into(),
                    title: "Work".into(),
                    color: Some("#ff8000".into()),
                    source: Some("Exchange".into()),
                }
            );

            let attendees = NSArray::from_retained_slice(&[
                participant(false, EKParticipantStatus::Declined),
                participant(true, EKParticipantStatus::Declined),
            ]);
            let meeting = event(EventIvars {
                start: Some(NSDate::dateWithTimeIntervalSince1970(1_759_737_600.0)),
                end: Some(NSDate::dateWithTimeIntervalSince1970(1_759_739_400.0)),
                calendar: Some(work.clone()),
                item: NSString::from_str("E5F6A7B8-1111-4111-9111-111111111111"),
                title: Some(NSString::from_str("Sprint review #123")),
                attendees: Some(attendees),
                url: Some(
                    NSURL::URLWithString(&NSString::from_str(
                        "https://dev.azure.com/org/project/_workitems/edit/123",
                    ))
                    .expect("url"),
                ),
                all_day: false,
                status: EKEventStatus::Confirmed,
                availability: EKEventAvailability::Free,
                location: Some(NSString::from_str("Room 1")),
                notes: Some(NSString::from_str("Agenda")),
            });
            // SAFETY: FakeEvent implements every selector `convert_event` sends.
            let converted = convert_event(unsafe { view::<EKEvent>(&meeting) }).expect("event");
            assert_eq!(
                converted,
                CalendarEvent {
                    // The Swift 6.4 value for this calendar, item and start (see the vectors above).
                    occurrence_id:
                        "d0a85b8b85368de3eb074d2b14c1f64fae6eea3fe2a75067f41e242901e98190".into(),
                    calendar_id: "A1B2C3D4-0000-4000-8000-000000000001".into(),
                    title: "Sprint review #123".into(),
                    start: Timestamp::from_second(1_759_737_600).expect("start"),
                    end: Timestamp::from_second(1_759_739_400).expect("end"),
                    all_day: false,
                    status: EventStatus::Confirmed,
                    declined: true,
                    free: true,
                    location: Some("Room 1".into()),
                    notes: Some("Agenda".into()),
                    url: Some("https://dev.azure.com/org/project/_workitems/edit/123".into()),
                    calendar_color: Some("#ff8000".into()),
                }
            );

            // Only the current user's own decline counts; nil fields stay empty.
            let bare = event(EventIvars {
                start: Some(NSDate::dateWithTimeIntervalSince1970(1_759_737_600.5)),
                end: Some(NSDate::dateWithTimeIntervalSince1970(1_759_741_200.0)),
                calendar: None,
                item: NSString::from_str("item"),
                title: None,
                attendees: Some(NSArray::from_retained_slice(&[participant(
                    false,
                    EKParticipantStatus::Declined,
                )])),
                url: None,
                all_day: true,
                status: EKEventStatus::Canceled,
                availability: EKEventAvailability::Busy,
                location: None,
                notes: None,
            });
            let converted = convert_event(unsafe { view::<EKEvent>(&bare) }).expect("bare event");
            assert_eq!(converted.occurrence_id, occurrence_id("", "item", 1_759_737_600.5));
            assert_eq!(converted.title, "", "a nil title is empty");
            assert_eq!(converted.calendar_id, "");
            assert!(converted.all_day && !converted.declined && !converted.free);
            assert_eq!(converted.status, EventStatus::Canceled);
            assert_eq!(
                (converted.location, converted.notes, converted.url, converted.calendar_color),
                (None, None, None, None)
            );

            let undated = event(EventIvars {
                start: None,
                end: None,
                calendar: None,
                item: NSString::from_str("undated"),
                title: None,
                attendees: None,
                url: None,
                all_day: false,
                status: EKEventStatus::None,
                availability: EKEventAvailability::NotSupported,
                location: None,
                notes: None,
            });
            assert_eq!(convert_event(unsafe { view::<EKEvent>(&undated) }), None);
        });
    }
}

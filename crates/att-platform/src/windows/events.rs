//! Session and power notifications through a hidden message-only window.
//!
//! One dedicated thread per subscription owns the window and pumps its messages:
//!
//! - `WTSRegisterSessionNotification` → `WM_WTSSESSION_CHANGE`: lock/unlock and console or
//!   remote connect/disconnect ([`crate::windows_parse::session_change_event`]). Early in a logon
//!   the Remote Desktop Services may not be ready (`RPC_S_INVALID_BINDING`); registration is then
//!   retried every 5 s for 5 minutes.
//! - `RegisterSuspendResumeNotification` → `WM_POWERBROADCAST` suspend/resume. Message-only
//!   windows do not receive broadcasts, so the window registers for directed delivery.
//! - `RegisterPowerSettingNotification(GUID_CONSOLE_DISPLAY_STATE)` → display off/on.
//!
//! The sink is called on this thread; a panicking sink is caught and logged.

use std::cell::RefCell;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc;
use std::time::Duration;

use windows::Win32::Foundation::{
    ERROR_CLASS_ALREADY_EXISTS, HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Power::{
    POWERBROADCAST_SETTING, RegisterPowerSettingNotification, RegisterSuspendResumeNotification,
};
use windows::Win32::System::RemoteDesktop::{
    NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DEVICE_NOTIFY_WINDOW_HANDLE, DefWindowProcW, DispatchMessageW, GetMessageW,
    HWND_MESSAGE, KillTimer, MSG, RegisterClassW, SetTimer, WINDOW_EX_STYLE, WINDOW_STYLE,
    WM_POWERBROADCAST, WM_TIMER, WM_WTSSESSION_CHANGE, WNDCLASSW,
};
use windows::core::{GUID, PCWSTR, w};

use super::system::failure;
use crate::windows_parse::{PowerTracker, pbt, session_change_event};
use crate::{PlatformError, Result, SystemEvent, SystemEventSink};

const CLASS_NAME: PCWSTR = w!("AzureTimetrackerSystemEvents");
const SESSION_RETRY_TIMER: usize = 1;
const SESSION_RETRY_MS: u32 = 5_000;
const SESSION_RETRY_LIMIT: u32 = 60;
/// `GUID_CONSOLE_DISPLAY_STATE` (winnt.h): 0 off, 1 on, 2 dimmed.
const GUID_CONSOLE_DISPLAY_STATE: GUID = GUID::from_u128(0x6fe69556_704a_47a0_8f24_c28d936fda47);

struct Listener {
    sink: SystemEventSink,
    power: PowerTracker,
    session_retries: u32,
}

thread_local! {
    /// The listener of this event thread; the window procedure runs on the same thread.
    static LISTENER: RefCell<Option<Listener>> = const { RefCell::new(None) };
}

/// Starts the event thread and waits until its window exists.
pub(crate) fn start(sink: SystemEventSink) -> Result<()> {
    let (ready, started) = mpsc::channel();
    std::thread::Builder::new()
        .name("att-system-events".to_string())
        .spawn(move || run(sink, ready))
        .map_err(|error| {
            PlatformError::Failed(format!(
                "Windows session notifications could not start ({error})."
            ))
        })?;
    started.recv_timeout(Duration::from_secs(5)).unwrap_or_else(|_| {
        Err(PlatformError::Failed(
            "Windows session notifications did not start in time.".to_string(),
        ))
    })
}

fn run(sink: SystemEventSink, ready: mpsc::Sender<Result<()>>) {
    LISTENER.with(|listener| {
        *listener.borrow_mut() =
            Some(Listener { sink, power: PowerTracker::default(), session_retries: 0 });
    });
    let window = match create_window() {
        Ok(window) => window,
        Err(error) => {
            let _ =
                ready.send(Err(failure("Windows session notifications could not start", &error)));
            return;
        }
    };
    let recipient = HANDLE(window.0);
    // The registration handles are kept for the life of the process, like the thread.
    // SAFETY: `window` is a live window owned by this thread.
    if let Err(error) =
        unsafe { RegisterSuspendResumeNotification(recipient, DEVICE_NOTIFY_WINDOW_HANDLE) }
    {
        tracing::warn!(%error, "suspend/resume notifications unavailable");
    }
    // SAFETY: as above; the GUID outlives the call.
    if let Err(error) = unsafe {
        RegisterPowerSettingNotification(
            recipient,
            &GUID_CONSOLE_DISPLAY_STATE,
            DEVICE_NOTIFY_WINDOW_HANDLE,
        )
    } {
        tracing::warn!(%error, "display state notifications unavailable");
    }
    if !register_session(window) {
        // SAFETY: `window` is owned by this thread; the timer is killed in `retry_session`.
        unsafe { SetTimer(Some(window), SESSION_RETRY_TIMER, SESSION_RETRY_MS, None) };
    }
    let _ = ready.send(Ok(()));
    let mut message = MSG::default();
    loop {
        // SAFETY: `message` is a valid out-parameter; 0 means WM_QUIT and -1 an error.
        let result = unsafe { GetMessageW(&mut message, None, 0, 0) };
        if result.0 <= 0 {
            tracing::debug!(result = result.0, "system event loop ended");
            break;
        }
        // SAFETY: dispatches a message retrieved by GetMessageW on this thread.
        unsafe { DispatchMessageW(&message) };
    }
}

fn create_window() -> windows::core::Result<HWND> {
    // SAFETY: plain calls; the class and window live as long as the process.
    unsafe {
        let instance: HINSTANCE = GetModuleHandleW(None)?.into();
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_procedure),
            hInstance: instance,
            lpszClassName: CLASS_NAME,
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            let error = windows::core::Error::from_thread();
            // A second subscription reuses the class.
            if error.code() != ERROR_CLASS_ALREADY_EXISTS.to_hresult() {
                return Err(error);
            }
        }
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            CLASS_NAME,
            w!("Azure timetracker system events"),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        )
    }
}

fn register_session(window: HWND) -> bool {
    // SAFETY: `window` is a live window owned by this thread.
    match unsafe { WTSRegisterSessionNotification(window, NOTIFY_FOR_THIS_SESSION) } {
        Ok(()) => true,
        Err(error) => {
            tracing::debug!(%error, "session notifications not registered yet");
            false
        }
    }
}

fn retry_session(window: HWND) {
    let exhausted = with_listener(|listener| {
        listener.session_retries += 1;
        Some(listener.session_retries >= SESSION_RETRY_LIMIT)
    })
    .unwrap_or(true);
    let registered = register_session(window);
    if registered || exhausted {
        if !registered {
            tracing::warn!("session lock notifications unavailable; relying on sampling");
        }
        // SAFETY: the timer was set on this window by this thread.
        let _ = unsafe { KillTimer(Some(window), SESSION_RETRY_TIMER) };
    }
}

fn with_listener<T>(update: impl FnOnce(&mut Listener) -> Option<T>) -> Option<T> {
    LISTENER.with(|listener| listener.borrow_mut().as_mut().and_then(update))
}

/// Calls the sink outside any borrow, so a re-entrant message cannot hit a borrowed listener.
fn deliver(event: Option<SystemEvent>) {
    let Some(event) = event else { return };
    let Some(sink) = LISTENER.with(|listener| listener.borrow().as_ref().map(|l| l.sink.clone()))
    else {
        return;
    };
    if catch_unwind(AssertUnwindSafe(|| sink(event))).is_err() {
        tracing::error!(?event, "system event sink panicked");
    }
}

/// `GUID_CONSOLE_DISPLAY_STATE` value carried by a `PBT_POWERSETTINGCHANGE`.
///
/// # Safety
/// `lparam` must be the lParam of a `WM_POWERBROADCAST` / `PBT_POWERSETTINGCHANGE` message.
unsafe fn display_state(lparam: LPARAM) -> Option<u32> {
    let setting = lparam.0 as *const POWERBROADCAST_SETTING;
    if setting.is_null() {
        return None;
    }
    // SAFETY: Windows passes a POWERBROADCAST_SETTING followed by `DataLength` bytes of data.
    unsafe {
        let guid = std::ptr::addr_of!((*setting).PowerSetting).read_unaligned();
        let length = std::ptr::addr_of!((*setting).DataLength).read_unaligned();
        if guid != GUID_CONSOLE_DISPLAY_STATE || (length as usize) < size_of::<u32>() {
            return None;
        }
        Some(std::ptr::addr_of!((*setting).Data).cast::<u32>().read_unaligned())
    }
}

unsafe extern "system" fn window_procedure(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_WTSSESSION_CHANGE => {
            deliver(session_change_event(wparam.0 as u32));
            LRESULT(0)
        }
        WM_POWERBROADCAST => {
            let kind = wparam.0 as u32;
            let event = if kind == pbt::POWER_SETTING_CHANGE {
                // SAFETY: this is the lParam of a PBT_POWERSETTINGCHANGE broadcast.
                unsafe { display_state(lparam) }
                    .and_then(|state| with_listener(|listener| listener.power.display(state)))
            } else {
                with_listener(|listener| listener.power.power(kind))
            };
            deliver(event);
            // TRUE grants legacy query requests; ignored for the notifications above.
            LRESULT(1)
        }
        WM_TIMER if wparam.0 == SESSION_RETRY_TIMER => {
            retry_session(window);
            LRESULT(0)
        }
        // SAFETY: default handling for every other message of this window.
        _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
    }
}

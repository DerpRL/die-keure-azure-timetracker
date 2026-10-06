//! Manual probe for the Windows platform implementation (Windows only).
//!
//! ```text
//! cargo run -p att-platform --example probe_windows -- <command> [seconds]
//!
//!   all                one reading of every probe (default, read-only)
//!   presence [10]      idle time, lock state and foreground app every second
//!   events [120]       session and power events as they arrive
//!   mic [30]           microphone candidates, WASAPI sessions and owners every 2 s
//!   figma [30]         Figma observation every 2 s, with timing
//!   credentials        save/read/delete round trip in a throwaway Credential Manager service
//!   identity <path>    app identity of an .exe
//! ```
//!
//! The steps for a tester are in `docs/port/platform-windows.md`.

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    probe::main()
}

#[cfg(not(windows))]
fn main() {
    eprintln!("probe_windows runs on Windows only. See docs/port/platform-windows.md.");
}

#[cfg(windows)]
mod probe {
    use std::path::Path;
    use std::process::ExitCode;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use att_platform::windows::{
        WindowsCredentials, WindowsFigma, WindowsMicrophone, WindowsPresence,
    };
    use att_platform::windows_parse::{ConsentApp, SessionView, filetime_to_timestamp};
    use att_platform::{Credentials, FigmaObserver, Platform, PresenceProbe, SystemEventSink};
    use jiff::Zoned;

    const USAGE: &str = "usage: probe_windows [all | presence [s] | events [s] | mic [s] | figma [s] | credentials | identity <path.exe>]";

    pub fn main() -> ExitCode {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let seconds = |default: u64| {
            Duration::from_secs(args.get(1).and_then(|value| value.parse().ok()).unwrap_or(default))
        };
        match args.first().map(String::as_str).unwrap_or("all") {
            "all" => all(),
            "presence" => presence(seconds(10)),
            "events" => events(seconds(120)),
            "mic" => microphone(seconds(30)),
            "figma" => figma(seconds(30)),
            "credentials" => credentials(),
            "identity" => match args.get(1) {
                Some(path) => identity(path),
                None => usage(),
            },
            _ => usage(),
        }
    }

    fn usage() -> ExitCode {
        eprintln!("{USAGE}");
        ExitCode::from(2)
    }

    fn stamp() -> String {
        Zoned::now().strftime("%H:%M:%S").to_string()
    }

    fn all() -> ExitCode {
        let platform = Platform::native();
        println!("calendar access: {:?}", platform.calendar.access());
        println!("microphone supported: {}", platform.microphone.supported());
        println!("presence: {:?}", platform.presence.sample());
        print_microphone(&WindowsMicrophone::new());
        let started = Instant::now();
        println!("figma: {:?} ({} ms)", platform.figma.observe(), started.elapsed().as_millis());
        println!("figma installed: {}", platform.figma.figma_installed());
        ExitCode::SUCCESS
    }

    fn presence(duration: Duration) -> ExitCode {
        let presence = WindowsPresence::new();
        let end = Instant::now() + duration;
        while Instant::now() < end {
            let sample = presence.sample();
            let foreground = sample
                .foreground
                .map(|app| format!("{} \"{}\" {}", app.id, app.name, app.path.unwrap_or_default()))
                .unwrap_or_else(|| "none".to_string());
            println!(
                "{} idle {:.1} s · locked {:?} · foreground {foreground}",
                stamp(),
                sample.idle_seconds,
                sample.locked
            );
            std::thread::sleep(Duration::from_secs(1));
        }
        ExitCode::SUCCESS
    }

    fn events(duration: Duration) -> ExitCode {
        let sink: SystemEventSink = Arc::new(|event| println!("{} {event:?}", stamp()));
        if let Err(error) = WindowsPresence::new().subscribe(sink) {
            eprintln!("subscribe failed: {error}");
            return ExitCode::FAILURE;
        }
        println!(
            "{} listening for {} s: lock (Win+L), sleep, switch user, turn the display off",
            stamp(),
            duration.as_secs()
        );
        std::thread::sleep(duration);
        ExitCode::SUCCESS
    }

    fn microphone(duration: Duration) -> ExitCode {
        let microphone = WindowsMicrophone::new();
        let end = Instant::now() + duration;
        while Instant::now() < end {
            print_microphone(&microphone);
            std::thread::sleep(Duration::from_secs(2));
        }
        ExitCode::SUCCESS
    }

    fn print_microphone(microphone: &WindowsMicrophone) {
        let started = Instant::now();
        let diagnosis = match microphone.diagnose() {
            Ok(diagnosis) => diagnosis,
            Err(error) => {
                println!("{} microphone error: {error}", stamp());
                return;
            }
        };
        println!("{} microphone ({} ms)", stamp(), started.elapsed().as_millis());
        for candidate in &diagnosis.candidates {
            let since = filetime_to_timestamp(candidate.started)
                .map(|ts| ts.to_string())
                .unwrap_or_default();
            match &candidate.app {
                ConsentApp::Packaged { family } => {
                    println!("  registry packaged {family} since {since}")
                }
                ConsentApp::NonPackaged { key } => {
                    println!("  registry desktop {key} since {since}")
                }
            }
        }
        let (kind, sessions) = match &diagnosis.sessions {
            SessionView::Complete(sessions) => ("complete", sessions.as_slice()),
            SessionView::Partial(sessions) => ("partial", sessions.as_slice()),
            SessionView::Unavailable => ("unavailable", &[][..]),
        };
        println!("  wasapi {kind}");
        for session in sessions {
            println!(
                "  session pid {} {} {}",
                session.pid,
                session.path.as_deref().unwrap_or("?"),
                session.family.as_deref().unwrap_or("(unpackaged)")
            );
        }
        for owner in &diagnosis.owners {
            println!(
                "  owner {} \"{}\" pid {:?} {}",
                owner.id,
                owner.name,
                owner.pid,
                owner.path.as_deref().unwrap_or("")
            );
        }
        if diagnosis.owners.is_empty() {
            println!("  owner none");
        }
    }

    fn figma(duration: Duration) -> ExitCode {
        let figma = WindowsFigma::new();
        println!("figma installed: {}", figma.figma_installed());
        let end = Instant::now() + duration;
        while Instant::now() < end {
            let started = Instant::now();
            let observation = figma.observe();
            println!("{} {observation:?} ({} ms)", stamp(), started.elapsed().as_millis());
            std::thread::sleep(Duration::from_secs(2));
        }
        ExitCode::SUCCESS
    }

    fn credentials() -> ExitCode {
        let store = WindowsCredentials::new("be.yarne.azure-timetracker.probe");
        let account = format!("probe:{}", std::process::id());
        let long: String = (0..6_000).map(|index| char::from(b'a' + (index % 26) as u8)).collect();
        let mut failed = false;
        let mut check = |label: &str, ok: bool| {
            println!("{} {label}", if ok { "PASS" } else { "FAIL" });
            failed |= !ok;
        };
        check("missing reads as none", store.get(&account) == Ok(None));
        check("save short", store.set(&account, "probe-secret").is_ok());
        check("read short", store.get(&account) == Ok(Some("probe-secret".to_string())));
        check("save 6000 bytes", store.set(&account, &long).is_ok());
        check("read 6000 bytes", store.get(&account) == Ok(Some(long.clone())));
        check("save short again", store.set(&account, "short").is_ok());
        check("read short again", store.get(&account) == Ok(Some("short".to_string())));
        check("delete", store.delete(&account).is_ok());
        check("deleted reads as none", store.get(&account) == Ok(None));
        check("delete missing", store.delete(&account).is_ok());
        println!(
            "target names: {}:{account} and {}:{account}#part2…",
            store.service(),
            store.service()
        );
        if failed { ExitCode::FAILURE } else { ExitCode::SUCCESS }
    }

    fn identity(path: &str) -> ExitCode {
        match WindowsPresence::new().app_identity(Path::new(path)) {
            Ok(identity) => {
                println!("{identity:?}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("{error}");
                ExitCode::FAILURE
            }
        }
    }
}

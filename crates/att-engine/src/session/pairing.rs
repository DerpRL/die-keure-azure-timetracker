//! 7pace mobile PIN pairing (Swift `PinPairingModel`): request a PIN, poll its status every
//! 2 s for at most 60 s, exchange the secret and save the tokens with the 1.14.x Keychain
//! account (`7pace-oauth:<host>`).

use std::time::Duration;

use jiff::Timestamp;

use att_core::AppError;
use att_core::time::add_secs;
use att_net::{Endpoint, SevenPacePinStatus};

use crate::clients::save_oauth;
use crate::engine::Engine;

/// The PIN is valid this long (Swift 60 s).
const PIN_SECONDS: u64 = 60;
/// Status polls are this far apart (Swift 2 s).
const POLL: Duration = Duration::from_secs(2);

#[derive(Default)]
pub(crate) struct PairingState {
    pub pin: Option<String>,
    pub expires_at: Option<Timestamp>,
    pub busy: bool,
    pub status: Option<String>,
    pub paired_host: Option<String>,
    pub generation: u64,
}

/// Swift `cancel()`.
pub(crate) fn cancel(engine: &Engine) {
    engine.update(|state| {
        let pairing = &mut state.session.pairing;
        pairing.generation += 1;
        pairing.pin = None;
        pairing.expires_at = None;
        pairing.busy = false;
        pairing.status = None;
        pairing.paired_host = None;
    });
}

fn current(engine: &Engine, generation: u64) -> bool {
    engine.read(|state| state.session.pairing.generation == generation)
}

fn set_status(engine: &Engine, generation: u64, status: impl Into<String>) {
    let status = status.into();
    engine.update(|state| {
        if state.session.pairing.generation == generation {
            state.session.pairing.status = Some(status);
        }
    });
}

/// Swift `begin(workspace:)`: runs in the background; the `settings` slice shows the PIN and
/// the status.
pub(crate) fn begin(engine: &Engine, workspace: String) {
    if engine.preview() {
        return;
    }
    cancel(engine);
    let generation = engine.update(|state| {
        let pairing = &mut state.session.pairing;
        pairing.busy = true;
        pairing.generation
    });
    let Ok(handle) = tokio::runtime::Handle::try_current() else { return };
    let engine = engine.clone();
    handle.spawn(async move {
        if let Err(error) = run(&engine, &workspace, generation).await
            && current(&engine, generation)
        {
            set_status(&engine, generation, format!("Could not pair with 7pace. {error}"));
        }
        engine.update(|state| {
            let pairing = &mut state.session.pairing;
            if pairing.generation == generation {
                pairing.busy = false;
                pairing.pin = None;
                pairing.expires_at = None;
            }
        });
    });
}

async fn run(engine: &Engine, workspace: &str, generation: u64) -> att_core::Result<()> {
    let base = Endpoint::seven_pace(workspace)?;
    let host = base.host_str().unwrap_or_default().to_string();
    let client = engine.services().clients.pairing(workspace)?;
    set_status(engine, generation, "Requesting a PIN…");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(PIN_SECONDS);
    let expires_at = add_secs(engine.now(), PIN_SECONDS as f64);
    let code = client.create_pin().await?;
    if !current(engine, generation) {
        return Ok(());
    }
    engine.update(|state| {
        let pairing = &mut state.session.pairing;
        pairing.pin = Some(code.pin.clone());
        pairing.expires_at = Some(expires_at);
        pairing.status =
            Some("Enter this PIN in 7pace → Apps → Pair Mobile App. Waiting for approval…".into());
    });
    while tokio::time::Instant::now() < deadline {
        tokio::time::sleep(POLL).await;
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        let status = client.status(&code.secret).await?;
        if !current(engine, generation) {
            return Ok(());
        }
        match status {
            SevenPacePinStatus::Expired => break,
            SevenPacePinStatus::Waiting => {}
            SevenPacePinStatus::Validated => {
                let tokens = client.exchange(&code.secret).await?;
                if !current(engine, generation) {
                    return Ok(());
                }
                let credentials = engine.services().platform.credentials.clone();
                let scope = host.clone();
                tokio::task::spawn_blocking(move || {
                    save_oauth(credentials.as_ref(), &scope, &tokens)
                })
                .await
                .unwrap_or_else(|error| Err(AppError::Message(error.to_string())))?;
                engine.update(|state| {
                    let pairing = &mut state.session.pairing;
                    if pairing.generation == generation {
                        pairing.paired_host = Some(host.clone());
                        pairing.status = Some(format!(
                            "Paired with {host}. Save changes to use this connection."
                        ));
                    }
                });
                return Ok(());
            }
        }
    }
    set_status(
        engine,
        generation,
        "The PIN expired. Request a new PIN and enter it within one minute.",
    );
    Ok(())
}

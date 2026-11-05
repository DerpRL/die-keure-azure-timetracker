//! 7pace mobile PIN pairing (Swift `PinPairingModel`): request a PIN, poll its status every
//! 2 s for at most 60 s, exchange the secret and save the tokens with the 1.14.x Keychain
//! account (`7pace-oauth:<host>`). `pairing.unpair` forgets them again.

use std::time::Duration;

use jiff::Timestamp;

use serde_json::Value;

use att_core::AppError;
use att_core::time::add_secs;
use att_net::{Endpoint, SevenPacePinStatus};

use crate::clients::{accounts, save_oauth};
use crate::controllers::hooks as controllers;
use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;

use super::{busy, connection};

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

/// `pairing.unpair` (Settings → Accounts → Unpair): forgets the 7pace credential of the saved
/// workspace (the paired mobile-PIN tokens and the API token, both under the 1.14.x Keychain
/// accounts `7pace-oauth:<host>` and `7pace:<host>`) and disconnects. Every setting, the Azure
/// token and the 7pace timer itself are left alone. Refused while a write or an upload runs;
/// nothing is stored in preview.
pub(crate) async fn unpair(engine: &Engine) -> Result<Value, IpcError> {
    if engine.preview() {
        return done();
    }
    if busy(engine) || engine.read(controllers::offline_working) {
        return Err(IpcError::busy());
    }
    cancel(engine);
    let url = engine.read(|state| state.config.seven_pace_url.clone());
    let host = Endpoint::seven_pace(&url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .filter(|host| !host.is_empty());
    if let Some(host) = host.clone() {
        let credentials = engine.services().platform.credentials.clone();
        // Keychain writes can wait for a system prompt: blocking pool, no short deadline.
        tokio::task::spawn_blocking(move || {
            credentials.delete(&accounts::seven_pace_oauth(&host))?;
            credentials.delete(&accounts::seven_pace_token(&host))
        })
        .await
        .map_err(|error| IpcError::new("internal", error.to_string()))?
        .map_err(|error| {
            IpcError::new(
                "message",
                format!("Keychain could not remove the 7pace credential ({error})."),
            )
        })?;
    }
    // The Azure token is not touched: Settings keeps showing it as stored.
    let has_azure_pat = engine.read(|state| state.session.connection.has_azure_pat);
    if !connection::disconnect(engine).await {
        return Err(IpcError::busy());
    }
    engine.update(|state| state.session.connection.has_azure_pat = has_azure_pat);
    engine.record("Unpaired from 7pace", host.unwrap_or_default());
    done()
}

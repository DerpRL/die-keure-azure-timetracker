//! One reading of every macOS probe, for manual verification:
//!
//! ```sh
//! cargo run -p att-platform --example probe_macos
//! ```
//!
//! Never shows a permission prompt: calendar and accessibility access are only read, and the
//! Keychain is not touched. Microphone owners and the foreground app are printed as bundle IDs
//! and app names; nothing else about them is read.

#[cfg(target_os = "macos")]
fn main() {
    let platform = att_platform::Platform::native();

    let microphone = &platform.microphone;
    println!("microphone.supported(): {}", microphone.supported());
    match microphone.sample() {
        Ok(owners) if owners.is_empty() => println!("microphone.sample(): no app is using input"),
        Ok(owners) => {
            println!("microphone.sample(): {} process(es) with input running", owners.len());
            for owner in owners {
                println!("  - {} [{}] pid {:?}", owner.name, owner.id, owner.pid);
            }
        }
        Err(error) => println!("microphone.sample(): error: {error}"),
    }

    let sample = platform.presence.sample();
    println!("presence.sample().idle_seconds: {:.1}", sample.idle_seconds);
    println!("presence.sample().locked: {:?}", sample.locked);
    match sample.foreground {
        Some(app) => println!(
            "presence.sample().foreground: {} [{}] at {}",
            app.name,
            app.id,
            app.path.as_deref().unwrap_or("?")
        ),
        None => println!("presence.sample().foreground: none"),
    }

    println!("calendar.access(): {:?}", platform.calendar.access());

    println!("figma.has_access(): {}", platform.figma.has_access());
    println!("figma.figma_installed(): {}", platform.figma.figma_installed());
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("probe_macos only runs on macOS.");
}

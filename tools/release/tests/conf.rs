//! The checked-in shell configuration passes the release review (`build-macos`,
//! `build-windows` and `package-macos` refuse to run otherwise).

use att_release::repo::{TauriConf, resolve_pubkey, root};

#[test]
fn the_shell_configuration_is_release_ready() {
    let repository = root(None).unwrap();
    let conf =
        TauriConf::load(&repository).unwrap().expect("apps/desktop/src-tauri/tauri.conf.json");
    let (errors, warnings) = conf.review();
    assert!(errors.is_empty(), "{errors:#?}");
    assert!(warnings.is_empty(), "{warnings:#?}");
    let (_, source) = resolve_pubkey(None, &repository).unwrap();
    assert!(source.contains("key id"), "{source}");
}

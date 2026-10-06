//! The 1.14.x import runs only from the folder the services name, never by default in tests.

use std::sync::Arc;

use att_engine::testing::TestEngine;
use att_store::Store;

#[test]
fn test_engines_never_import_on_their_own() {
    let test = TestEngine::new();
    assert!(!test.store.legacy_imported().unwrap());
}

#[test]
fn the_named_legacy_folder_is_imported_once() {
    let legacy = tempfile::tempdir().unwrap();
    std::fs::write(
        legacy.path().join("state.json"),
        r#"{"configuration": {"organization": "contoso", "project": "Webshop",
            "sevenPaceURL": "https://contoso.timehub.7pace.com"}}"#,
    )
    .unwrap();
    let store = Arc::new(Store::open_in_memory().unwrap());
    let test = TestEngine::with_legacy(store.clone(), Some(legacy.path().to_path_buf()));
    let config = test.engine.configuration();
    assert_eq!((config.organization.as_str(), config.project.as_str()), ("contoso", "Webshop"));
    assert!(store.legacy_imported().unwrap());
    assert!(legacy.path().join(att_store::legacy::MARKER_FILE).is_file());
}

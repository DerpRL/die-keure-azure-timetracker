//! Ported from InterfacePreferencesTests.swift. The two tests that round-trip a whole
//! `Configuration` are adapted to the preferences alone; the `Configuration` halves
//! (accounts, update checks, `interfaceSetupCompleted`) wait for `Configuration`.

use att_core::interface_prefs::{
    InterfaceContrast, InterfacePreferences, InterfaceScale, InterfaceTheme,
};

#[test]
fn old_configurations_keep_accounts_and_use_system_defaults() {
    // A configuration without `interfacePreferences` uses the defaults and skips onboarding.
    let defaults = InterfacePreferences::default();
    assert_eq!(
        (defaults.theme, defaults.scale, defaults.contrast),
        (InterfaceTheme::System, InterfaceScale::Standard, InterfaceContrast::System)
    );
    assert!(!InterfacePreferences::needs_onboarding(true, None));
}

#[test]
fn first_run_and_interrupted_onboarding_prompt_but_completed_setup_does_not() {
    assert!(InterfacePreferences::needs_onboarding(false, None));
    assert!(InterfacePreferences::needs_onboarding(true, Some(false)));
    assert!(!InterfacePreferences::needs_onboarding(true, Some(true)));
    assert!(!InterfacePreferences::needs_onboarding(false, Some(true)));
}

#[test]
fn theme_overrides_only_when_explicit() {
    for theme in InterfaceTheme::ALL {
        let preferences = InterfacePreferences { theme, ..InterfacePreferences::default() };
        for dark in [false, true] {
            let expected =
                if theme == InterfaceTheme::System { dark } else { theme == InterfaceTheme::Dark };
            assert_eq!(preferences.is_dark(dark), expected, "{theme:?} system dark {dark}");
        }
    }
}

#[test]
fn contrast_follows_system_or_explicit_choice() {
    for contrast in InterfaceContrast::ALL {
        let preferences = InterfacePreferences { contrast, ..InterfacePreferences::default() };
        for increased in [false, true] {
            let expected = if contrast == InterfaceContrast::System {
                increased
            } else {
                contrast == InterfaceContrast::Increased
            };
            assert_eq!(
                preferences.increased_contrast(increased),
                expected,
                "{contrast:?} {increased}"
            );
        }
    }
}

#[test]
fn preferences_and_completion_survive_restart() {
    for scale in InterfaceScale::ALL {
        let preferences = InterfacePreferences {
            theme: InterfaceTheme::Dark,
            scale,
            contrast: InterfaceContrast::Increased,
        };
        let restored: InterfacePreferences =
            serde_json::from_str(&serde_json::to_string(&preferences).unwrap()).unwrap();
        assert_eq!(restored, preferences, "{scale:?}");
        assert!((0.9..=1.5).contains(&restored.scale.factor()), "{scale:?}");
    }
}

#[test]
fn invalid_or_future_preferences_do_not_break_configuration() {
    let cases = [
        r#"{"theme":"future","scale":800,"contrast":"unknown"}"#,
        r#"{"theme":5,"scale":"large","contrast":null}"#,
        "[]",
        "{}",
        // Rust-only extras: other shapes and case-sensitive raw values.
        "null",
        r#""dark""#,
        r#"{"theme":"Dark","scale":110.5,"contrast":"INCREASED"}"#,
    ];
    for json in cases {
        let decoded: InterfacePreferences = serde_json::from_str(json).unwrap();
        assert_eq!(decoded, InterfacePreferences::default(), "{json}");
    }
}

#[test]
fn partial_preferences_preserve_valid_choices() {
    let settings: InterfacePreferences =
        serde_json::from_str(r#"{"theme":"light","scale":-1,"contrast":"increased"}"#).unwrap();
    assert_eq!(settings.theme, InterfaceTheme::Light);
    assert_eq!(settings.scale, InterfaceScale::Standard);
    assert_eq!(settings.contrast, InterfaceContrast::Increased);
}

#[test]
fn swift_interface_preferences_decode_and_write_raw_values() {
    let swift_json = r#"{"theme":"dark","scale":125,"contrast":"increased"}"#;
    let preferences: InterfacePreferences = serde_json::from_str(swift_json).unwrap();
    assert_eq!(
        preferences,
        InterfacePreferences {
            theme: InterfaceTheme::Dark,
            scale: InterfaceScale::Larger,
            contrast: InterfaceContrast::Increased,
        }
    );
    assert_eq!(serde_json::to_string(&preferences).unwrap(), swift_json);
    let defaults = serde_json::to_string(&InterfacePreferences::default()).unwrap();
    assert_eq!(defaults, r#"{"theme":"system","scale":100,"contrast":"system"}"#);
    // Standalone scales are strict.
    assert!(serde_json::from_str::<InterfaceScale>("105").is_err());
    assert_eq!(serde_json::from_str::<InterfaceScale>("150").unwrap(), InterfaceScale::Largest);
}

#[test]
fn labels_raw_values_and_factors_match_swift() {
    let themes: Vec<(&str, &str)> =
        InterfaceTheme::ALL.iter().map(|t| (t.raw(), t.label())).collect();
    assert_eq!(themes, [("system", "System"), ("light", "Light"), ("dark", "Dark")]);
    let contrasts: Vec<(&str, &str)> =
        InterfaceContrast::ALL.iter().map(|c| (c.raw(), c.label())).collect();
    assert_eq!(
        contrasts,
        [("system", "System"), ("standard", "Standard"), ("increased", "Increased")]
    );
    let scales: Vec<(i64, String, f64)> =
        InterfaceScale::ALL.iter().map(|s| (s.raw(), s.label(), s.factor())).collect();
    let expected = [
        (90, "90%", 0.9),
        (100, "100%", 1.0),
        (110, "110%", 1.1),
        (125, "125%", 1.25),
        (150, "150%", 1.5),
    ];
    for ((raw, label, factor), (raw_e, label_e, factor_e)) in scales.into_iter().zip(expected) {
        assert_eq!((raw, label.as_str()), (raw_e, label_e));
        assert!((factor - factor_e).abs() < 1e-12, "{raw}");
    }
    for theme in InterfaceTheme::ALL {
        assert_eq!(InterfaceTheme::from_raw(theme.raw()), Some(theme));
    }
    for contrast in InterfaceContrast::ALL {
        assert_eq!(InterfaceContrast::from_raw(contrast.raw()), Some(contrast));
    }
    for scale in InterfaceScale::ALL {
        assert_eq!(InterfaceScale::from_raw(scale.raw()), Some(scale));
    }
}

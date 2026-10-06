//! Appearance preferences and the onboarding rule. Ported from InterfacePreferences.swift.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterfaceTheme {
    #[default]
    System,
    Light,
    Dark,
}

impl InterfaceTheme {
    pub const ALL: [Self; 3] = [Self::System, Self::Light, Self::Dark];

    pub fn raw(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    pub fn from_raw(raw: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|theme| theme.raw() == raw)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::System => "System",
            Self::Light => "Light",
            Self::Dark => "Dark",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterfaceContrast {
    #[default]
    System,
    Standard,
    Increased,
}

impl InterfaceContrast {
    pub const ALL: [Self; 3] = [Self::System, Self::Standard, Self::Increased];

    pub fn raw(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Standard => "standard",
            Self::Increased => "increased",
        }
    }

    pub fn from_raw(raw: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|contrast| contrast.raw() == raw)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::System => "System",
            Self::Standard => "Standard",
            Self::Increased => "Increased",
        }
    }
}

/// Interface scale in percent. Persisted as the integer percentage.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum InterfaceScale {
    Compact = 90,
    #[default]
    Standard = 100,
    Large = 110,
    Larger = 125,
    Largest = 150,
}

impl InterfaceScale {
    pub const ALL: [Self; 5] =
        [Self::Compact, Self::Standard, Self::Large, Self::Larger, Self::Largest];

    pub fn raw(self) -> i64 {
        self as i64
    }

    pub fn from_raw(raw: i64) -> Option<Self> {
        Self::ALL.into_iter().find(|scale| scale.raw() == raw)
    }

    /// 0.9 … 1.5.
    pub fn factor(self) -> f64 {
        self.raw() as f64 / 100.0
    }

    /// `"125%"`.
    pub fn label(self) -> String {
        format!("{}%", self.raw())
    }
}

impl Serialize for InterfaceScale {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_i64(self.raw())
    }
}

impl<'de> Deserialize<'de> for InterfaceScale {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = i64::deserialize(d)?;
        Self::from_raw(raw)
            .ok_or_else(|| serde::de::Error::custom(format!("unsupported interface scale {raw}")))
    }
}

/// Appearance settings. Persisted as `Configuration.interfacePreferences`.
///
/// Decoding never fails: unsupported future values, wrong types and non-objects fall back to
/// the defaults field by field, so they cannot prevent loading account and tracking settings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize)]
pub struct InterfacePreferences {
    pub theme: InterfaceTheme,
    pub scale: InterfaceScale,
    pub contrast: InterfaceContrast,
}

impl<'de> Deserialize<'de> for InterfacePreferences {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(d)?;
        let text = |key: &str| value.get(key).and_then(serde_json::Value::as_str);
        Ok(Self {
            theme: text("theme").and_then(InterfaceTheme::from_raw).unwrap_or_default(),
            scale: value
                .get("scale")
                .and_then(serde_json::Value::as_i64)
                .and_then(InterfaceScale::from_raw)
                .unwrap_or_default(),
            contrast: text("contrast").and_then(InterfaceContrast::from_raw).unwrap_or_default(),
        })
    }
}

impl InterfacePreferences {
    pub fn is_dark(&self, system_dark: bool) -> bool {
        self.theme == InterfaceTheme::Dark || (self.theme == InterfaceTheme::System && system_dark)
    }

    pub fn increased_contrast(&self, system_increased: bool) -> bool {
        self.contrast == InterfaceContrast::Increased
            || (self.contrast == InterfaceContrast::System && system_increased)
    }

    /// Older saved configurations predate onboarding and skip it; an explicitly unfinished
    /// setup resumes.
    pub fn needs_onboarding(has_saved_settings: bool, completed: Option<bool>) -> bool {
        completed.map_or(!has_saved_settings, |completed| !completed)
    }
}

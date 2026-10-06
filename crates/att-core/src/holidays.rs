//! Belgian public holidays and target exceptions. Ported from Holidays.swift.
//!
//! Holidays are civil dates, never fixed 24-hour offsets, so DST days work. Weekend holidays get
//! no automatic replacement date: employers decide those, and users add them as exceptions.

use jiff::{Span, Timestamp, civil::Date};
use serde::{Deserialize, Serialize};

use crate::targets::WorkTargets;
use crate::time::{Cal, Interval, diff_secs};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BelgianHoliday {
    pub date: Date,
    pub name: &'static str,
}

impl BelgianHoliday {
    /// The ten federal holidays of `year`, sorted by date. Empty outside 1583–9999.
    ///
    /// When two holidays share a date (Ascension on 1 May), the fixed holiday comes first.
    pub fn all(year: i64) -> Vec<Self> {
        if !(1583..=9999).contains(&year) {
            return Vec::new();
        }
        let day = |month: i64, day: i64| Date::new(year as i16, month as i8, day as i8).ok();
        // Meeus/Jones/Butcher Gregorian computus.
        let (a, b, c) = (year % 19, year / 100, year % 100);
        let (d, e) = (b / 4, b % 4);
        let f = (b + 8) / 25;
        let g = (b - f + 1) / 3;
        let h = (19 * a + b - d - g + 15) % 30;
        let (i, k) = (c / 4, c % 4);
        let l = (32 + 2 * e + 2 * i - h - k) % 7;
        let m = (a + 11 * h + 22 * l) / 451;
        let easter = day((h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
        let fixed = [
            (day(1, 1), "New Year’s Day"),
            (day(5, 1), "Labour Day"),
            (day(7, 21), "Belgian National Day"),
            (day(8, 15), "Assumption"),
            (day(11, 1), "All Saints’ Day"),
            (day(11, 11), "Armistice Day"),
            (day(12, 25), "Christmas Day"),
        ];
        let movable = [(1, "Easter Monday"), (39, "Ascension Day"), (50, "Whit Monday")].map(
            |(offset, name)| {
                (easter.and_then(|e| e.checked_add(Span::new().days(offset)).ok()), name)
            },
        );
        let mut days: Vec<Self> = fixed
            .into_iter()
            .chain(movable)
            .filter_map(|(date, name)| date.map(|date| Self { date, name }))
            .collect();
        // Stable, like Swift's sort, so equal dates keep the order above.
        days.sort_by_key(|holiday| holiday.date);
        days
    }

    /// The first holiday on `date`, if any.
    pub fn on(date: Date) -> Option<Self> {
        Self::all(date.year() as i64).into_iter().find(|holiday| holiday.date == date)
    }
}

/// Persisted as the exact Swift raw values.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TargetExceptionKind {
    #[serde(rename = "Full-day leave")]
    Leave,
    #[serde(rename = "Half-day leave")]
    HalfDay,
    #[serde(rename = "Replacement holiday")]
    Replacement,
    #[serde(rename = "Custom target")]
    Custom,
}

impl TargetExceptionKind {
    pub const ALL: [Self; 4] = [Self::Leave, Self::HalfDay, Self::Replacement, Self::Custom];

    /// The Swift raw value, also the user-facing label.
    pub fn raw(&self) -> &'static str {
        match self {
            Self::Leave => "Full-day leave",
            Self::HalfDay => "Half-day leave",
            Self::Replacement => "Replacement holiday",
            Self::Custom => "Custom target",
        }
    }
}

/// A date whose target differs from the weekly schedule.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TargetException {
    /// Gregorian `yyyy-MM-dd` in the user's local time zone.
    pub id: String,
    pub kind: TargetExceptionKind,
    /// Target hours for [`TargetExceptionKind::Custom`].
    #[serde(default)]
    pub hours: f64,
    #[serde(default)]
    pub note: String,
}

impl TargetException {
    pub fn new(date: Date, kind: TargetExceptionKind, hours: f64, note: impl Into<String>) -> Self {
        Self { id: Self::date_key(date), kind, hours, note: note.into() }
    }

    /// The exception key for the local day containing `at`.
    pub fn key(at: Timestamp, cal: &Cal) -> String {
        Self::date_key(cal.date(at))
    }

    /// `yyyy-MM-dd`, zero padded.
    pub fn date_key(date: Date) -> String {
        format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day())
    }

    /// The date `id` names when it is a canonical, existing `yyyy-MM-dd` date in years 1–9999.
    pub fn date(&self) -> Option<Date> {
        let bytes = self.id.as_bytes();
        let digits = |range: std::ops::Range<usize>| {
            bytes[range].iter().try_fold(0i64, |value, byte| {
                byte.is_ascii_digit().then(|| value * 10 + i64::from(byte - b'0'))
            })
        };
        if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return None;
        }
        let (year, month, day) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
        if year == 0 {
            return None;
        }
        Date::new(year as i16, month as i8, day as i8).ok()
    }

    /// A canonical date key and finite hours between 0 and 24.
    pub fn is_valid(&self) -> bool {
        self.date().is_some() && self.hours.is_finite() && (0.0..=24.0).contains(&self.hours)
    }
}

impl WorkTargets {
    /// Belgian holidays apply unless the user turned them off (older settings have no key).
    pub fn uses_belgian_holidays(&self) -> bool {
        self.belgian_holidays_enabled.unwrap_or(true)
    }

    pub fn set_uses_belgian_holidays(&mut self, value: bool) {
        self.belgian_holidays_enabled = Some(value);
    }

    pub fn exceptions(&self) -> &[TargetException] {
        self.date_exceptions.as_deref().unwrap_or(&[])
    }

    pub fn set_exceptions(&mut self, value: Vec<TargetException>) {
        self.date_exceptions = Some(value);
    }

    /// Mutable access; like the Swift setter, this stores an (empty) list when there was none.
    pub fn exceptions_mut(&mut self) -> &mut Vec<TargetException> {
        self.date_exceptions.get_or_insert_with(Vec::new)
    }

    pub(crate) fn exception_on(&self, date: Date) -> Option<&TargetException> {
        let key = TargetException::date_key(date);
        self.exceptions().iter().find(|item| item.id == key)
    }

    /// Why the local day containing `at` has a special target: the exception kind (plus its
    /// note), or the holiday name.
    pub fn reason(&self, at: Timestamp, cal: &Cal) -> Option<String> {
        self.reason_on(cal.date(at))
    }

    pub fn reason_on(&self, date: Date) -> Option<String> {
        if let Some(item) = self.exception_on(date) {
            let note =
                if item.note.is_empty() { String::new() } else { format!(" · {}", item.note) };
            return Some(format!("{}{note}", item.kind.raw()));
        }
        if !self.uses_belgian_holidays() {
            return None;
        }
        BelgianHoliday::on(date).map(|holiday| holiday.name.to_string())
    }

    /// Target seconds inside `interval`. Partial days count pro rata to the real day length, so a
    /// 23-hour DST day still yields its full target.
    pub fn seconds_in(&self, interval: Interval, cal: &Cal) -> f64 {
        let mut date = cal.date(interval.start);
        let mut day = cal.start_of_date(date);
        let mut total = 0.0;
        while day < interval.end {
            let Ok(next_date) = date.tomorrow() else { break };
            let next = cal.start_of_date(next_date);
            let covered = diff_secs(next.min(interval.end), day.max(interval.start)).max(0.0);
            total += self.daily_seconds_on(date) * covered / diff_secs(next, day);
            date = next_date;
            day = next;
        }
        total
    }
}

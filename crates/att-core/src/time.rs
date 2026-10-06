//! Time and calendar helpers that make the Swift port mechanical.
//!
//! Swift `Date` is a `Double` of seconds and `Calendar` carries the user's time zone. In Rust an
//! instant is a [`jiff::Timestamp`] and calendar arithmetic goes through [`Cal`], which wraps a
//! [`jiff::tz::TimeZone`]. Every function takes `now` and `cal` explicitly; nothing reads the
//! system clock or zone implicitly, so tests can pin `Europe/Brussels` as the Swift tests did.
//!
//! Translation table:
//!
//! | Swift | Rust |
//! |---|---|
//! | `a.timeIntervalSince(b)` | `diff_secs(a, b)` |
//! | `a.addingTimeInterval(x)` | `add_secs(a, x)` |
//! | `a.timeIntervalSince1970` | `secs(a)` |
//! | `Date(timeIntervalSince1970: x)` | `from_secs(x)` |
//! | `Date(timeIntervalSince1970: x.rounded())` | `round_to_second(a)` |
//! | `calendar.startOfDay(for: d)` | `cal.start_of_day(d)` |
//! | `calendar.date(byAdding: .day, value: n, to: d)` | `cal.add_days(d, n)` |
//! | `calendar.dateInterval(of: .weekOfYear, for: d)` (Monday first) | `cal.week_interval(d)` |
//! | `calendar.component(.weekday, from: d)` | `cal.swift_weekday(d)` (1 = Sunday) |
//! | `WireDate.parse(text, localIfUnspecified:)` | `wire_date::parse(text, Some(cal.tz()))` |
//! | `WireDate.localString(d)` | `wire_date::local_string(d, cal.tz())` |

use jiff::{
    Span, Timestamp, Zoned,
    civil::{self, Date, DateTime},
    tz::TimeZone,
};
use serde::{Deserialize, Serialize};

const NANOS_PER_SECOND: i128 = 1_000_000_000;

/// Seconds since the Unix epoch as `f64` (Swift `timeIntervalSince1970`).
pub fn secs(ts: Timestamp) -> f64 {
    let nanos = ts.as_nanosecond();
    if nanos % NANOS_PER_SECOND == 0 {
        (nanos / NANOS_PER_SECOND) as f64
    } else {
        nanos as f64 / 1e9
    }
}

/// The instant `seconds` after the Unix epoch. Non-finite or out-of-range values saturate.
pub fn from_secs(seconds: f64) -> Timestamp {
    if !seconds.is_finite() {
        return if seconds > 0.0 { Timestamp::MAX } else { Timestamp::MIN };
    }
    if seconds.fract() == 0.0
        && seconds.abs() < i64::MAX as f64
        && let Ok(ts) = Timestamp::from_second(seconds as i64)
    {
        return ts;
    }
    let nanos = (seconds * 1e9).round();
    Timestamp::from_nanosecond(nanos as i128).unwrap_or(if seconds > 0.0 {
        Timestamp::MAX
    } else {
        Timestamp::MIN
    })
}

/// `a - b` in seconds (Swift `a.timeIntervalSince(b)`).
pub fn diff_secs(a: Timestamp, b: Timestamp) -> f64 {
    let nanos = a.as_nanosecond() - b.as_nanosecond();
    if nanos % NANOS_PER_SECOND == 0 {
        (nanos / NANOS_PER_SECOND) as f64
    } else {
        nanos as f64 / 1e9
    }
}

/// `ts + seconds` (Swift `addingTimeInterval`).
pub fn add_secs(ts: Timestamp, seconds: f64) -> Timestamp {
    if seconds.fract() == 0.0 && seconds.abs() < 1e15 {
        let nanos = ts.as_nanosecond() + (seconds as i128) * NANOS_PER_SECOND;
        return Timestamp::from_nanosecond(nanos).unwrap_or(if seconds > 0.0 {
            Timestamp::MAX
        } else {
            Timestamp::MIN
        });
    }
    from_secs(secs(ts) + seconds)
}

/// Rounds to the nearest whole second, half away from zero (Swift `.rounded()`).
pub fn round_to_second(ts: Timestamp) -> Timestamp {
    let nanos = ts.as_nanosecond();
    let rem = nanos.rem_euclid(NANOS_PER_SECOND);
    let floor = nanos - rem;
    let rounded = if nanos >= 0 {
        if rem >= NANOS_PER_SECOND / 2 { floor + NANOS_PER_SECOND } else { floor }
    } else if rem > NANOS_PER_SECOND / 2 {
        floor + NANOS_PER_SECOND
    } else {
        floor
    };
    Timestamp::from_nanosecond(rounded).unwrap_or(ts)
}

/// Rounds down to a whole second (Swift `floor(timeIntervalSince1970)`).
pub fn floor_to_second(ts: Timestamp) -> Timestamp {
    let nanos = ts.as_nanosecond();
    Timestamp::from_nanosecond(nanos - nanos.rem_euclid(NANOS_PER_SECOND)).unwrap_or(ts)
}

/// A half-open interval `[start, end)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Interval {
    pub start: Timestamp,
    pub end: Timestamp,
}

impl Interval {
    pub fn new(start: Timestamp, end: Timestamp) -> Self {
        Self { start, end }
    }

    /// Length in seconds; negative when `end < start`.
    pub fn duration(&self) -> f64 {
        diff_secs(self.end, self.start)
    }

    /// Half-open membership: `start <= ts < end`.
    pub fn contains(&self, ts: Timestamp) -> bool {
        self.start <= ts && ts < self.end
    }

    /// Closed membership like Swift `DateInterval.contains`: `start <= ts <= end`.
    pub fn contains_closed(&self, ts: Timestamp) -> bool {
        self.start <= ts && ts <= self.end
    }

    /// The overlapping part with positive length, if any.
    pub fn intersection(&self, other: &Interval) -> Option<Interval> {
        let start = self.start.max(other.start);
        let end = self.end.min(other.end);
        (start < end).then_some(Interval { start, end })
    }

    /// Overlapping seconds (0 when the intervals only touch or are disjoint).
    pub fn overlap_secs(&self, other: &Interval) -> f64 {
        self.intersection(other).map_or(0.0, |i| i.duration())
    }
}

/// Calendar arithmetic in one time zone (Swift `Calendar` with a fixed `timeZone`).
///
/// Weeks start on Monday and use ISO numbering (`firstWeekday = 2`, `minimumDaysInFirstWeek = 4`).
/// Local times that fall in a DST gap move forward; repeated local times resolve to the earlier
/// instant, which matches Foundation's behaviour.
#[derive(Clone, Debug, PartialEq)]
pub struct Cal {
    tz: TimeZone,
}

impl Cal {
    pub fn new(tz: TimeZone) -> Self {
        Self { tz }
    }

    /// The user's current system time zone.
    pub fn system() -> Self {
        Self::new(TimeZone::system())
    }

    /// `Europe/Brussels`, the zone the Swift test-suite pins for DST cases.
    pub fn brussels() -> Self {
        Self::new(TimeZone::get("Europe/Brussels").expect("tzdb contains Europe/Brussels"))
    }

    pub fn utc() -> Self {
        Self::new(TimeZone::UTC)
    }

    pub fn tz(&self) -> &TimeZone {
        &self.tz
    }

    pub fn zoned(&self, ts: Timestamp) -> Zoned {
        ts.to_zoned(self.tz.clone())
    }

    pub fn civil(&self, ts: Timestamp) -> DateTime {
        self.zoned(ts).datetime()
    }

    pub fn date(&self, ts: Timestamp) -> Date {
        self.zoned(ts).date()
    }

    /// The instant for a local wall-clock time (gap: later, fold: earlier).
    pub fn at(&self, dt: DateTime) -> Timestamp {
        self.tz
            .to_ambiguous_zoned(dt)
            .compatible()
            .map(|z| z.timestamp())
            .unwrap_or_else(|_| self.tz.to_timestamp(dt).unwrap_or(Timestamp::UNIX_EPOCH))
    }

    /// The instant a local date's day begins.
    pub fn start_of_date(&self, date: Date) -> Timestamp {
        date.to_zoned(self.tz.clone())
            .and_then(|z| z.start_of_day())
            .map(|z| z.timestamp())
            .unwrap_or_else(|_| self.at(date.to_datetime(civil::Time::midnight())))
    }

    /// The instant at `hour:minute` on a local date.
    pub fn date_at(&self, date: Date, hour: i8, minute: i8) -> Timestamp {
        self.at(date.at(hour, minute, 0, 0))
    }

    pub fn start_of_day(&self, ts: Timestamp) -> Timestamp {
        self.start_of_date(self.date(ts))
    }

    /// Adds calendar days and keeps the local wall-clock time.
    pub fn add_days(&self, ts: Timestamp, days: i64) -> Timestamp {
        self.zoned(ts).checked_add(Span::new().days(days)).map(|z| z.timestamp()).unwrap_or(ts)
    }

    pub fn add_date_days(&self, date: Date, days: i64) -> Date {
        date.checked_add(Span::new().days(days)).unwrap_or(date)
    }

    /// The local day containing `ts`.
    pub fn day_interval(&self, ts: Timestamp) -> Interval {
        self.date_interval(self.date(ts))
    }

    pub fn date_interval(&self, date: Date) -> Interval {
        Interval::new(self.start_of_date(date), self.start_of_date(self.add_date_days(date, 1)))
    }

    /// The Monday-to-Monday ISO week containing `ts`.
    pub fn week_interval(&self, ts: Timestamp) -> Interval {
        let date = self.date(ts);
        let monday = self.add_date_days(date, -(date.weekday().to_monday_zero_offset() as i64));
        Interval::new(self.start_of_date(monday), self.start_of_date(self.add_date_days(monday, 7)))
    }

    pub fn month_interval(&self, ts: Timestamp) -> Interval {
        let first = self.date(ts).first_of_month();
        let next = first.checked_add(Span::new().months(1)).unwrap_or(first);
        Interval::new(self.start_of_date(first), self.start_of_date(next))
    }

    pub fn year_interval(&self, ts: Timestamp) -> Interval {
        let first = self.date(ts).first_of_year();
        let next = first.checked_add(Span::new().years(1)).unwrap_or(first);
        Interval::new(self.start_of_date(first), self.start_of_date(next))
    }

    /// Swift weekday numbering: 1 = Sunday … 7 = Saturday.
    pub fn swift_weekday(&self, ts: Timestamp) -> u8 {
        self.date(ts).weekday().to_sunday_one_offset() as u8
    }

    /// Monday-zero weekday: 0 = Monday … 6 = Sunday.
    pub fn monday_weekday(&self, ts: Timestamp) -> u8 {
        self.date(ts).weekday().to_monday_zero_offset() as u8
    }

    /// Minutes east of UTC at `ts` (7pace `timeZone` field).
    pub fn utc_offset_minutes(&self, ts: Timestamp) -> i32 {
        self.tz.to_offset(ts).seconds() / 60
    }
}

/// Wire date parsing and formatting. Ported from `WireDate` in Models.swift.
pub mod wire_date {
    use super::*;

    /// Parses ISO 8601 with an offset (with or without fractional seconds), then
    /// `yyyy-MM-dd'T'HH:mm:ss[.fraction]` without an offset. Offset-free values are local time in
    /// `local` when given, otherwise UTC.
    pub fn parse(text: &str, local: Option<&TimeZone>) -> Option<Timestamp> {
        let text = text.trim();
        if text.is_empty() {
            return None;
        }
        if let Ok(ts) = text.parse::<Timestamp>() {
            return Some(ts);
        }
        if !text.contains('T') {
            return None;
        }
        let dt = text.parse::<DateTime>().ok()?;
        let tz = local.cloned().unwrap_or(TimeZone::UTC);
        tz.to_ambiguous_zoned(dt).compatible().ok().map(|z| z.timestamp())
    }

    /// `yyyy-MM-dd'T'HH:mm:ss` in `tz`, without an offset, as 7pace expects.
    pub fn local_string(ts: Timestamp, tz: &TimeZone) -> String {
        ts.to_zoned(tz.clone()).strftime("%Y-%m-%dT%H:%M:%S").to_string()
    }

    /// RFC 3339 in UTC without fractional seconds.
    pub fn utc_string(ts: Timestamp) -> String {
        round_to_second(ts).strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
    }
}

/// Serde adapters for JSON written by the Swift app (`JSONEncoder` default date strategy):
/// a `Double` of seconds since 2001-01-01T00:00:00Z. Only the 1.14.x importer should use these.
pub mod swift_date {
    use super::*;
    use serde::{Deserializer, Serializer};

    /// Seconds between the Unix epoch and Apple's reference date.
    pub const REFERENCE_UNIX_SECONDS: f64 = 978_307_200.0;

    pub fn to_timestamp(reference_seconds: f64) -> Timestamp {
        from_secs(reference_seconds + REFERENCE_UNIX_SECONDS)
    }

    pub fn from_timestamp(ts: Timestamp) -> f64 {
        secs(ts) - REFERENCE_UNIX_SECONDS
    }

    pub fn serialize<S: Serializer>(ts: &Timestamp, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_f64(from_timestamp(*ts))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Timestamp, D::Error> {
        f64::deserialize(d).map(to_timestamp)
    }

    pub mod option {
        use super::*;

        pub fn serialize<S: Serializer>(ts: &Option<Timestamp>, s: S) -> Result<S::Ok, S::Error> {
            match ts {
                Some(ts) => s.serialize_some(&from_timestamp(*ts)),
                None => s.serialize_none(),
            }
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Timestamp>, D::Error> {
            Option::<f64>::deserialize(d).map(|v| v.map(to_timestamp))
        }
    }
}

/// Serde adapter for every persisted instant.
///
/// Writes RFC 3339 strings. Reads RFC 3339 strings, or numbers in the Swift `JSONEncoder`
/// default format (seconds since 2001-01-01), so the 1.14.x JSON files decode directly into the
/// Rust types. Use `#[serde(with = "crate::time::flex_date")]` on `Timestamp` fields,
/// `flex_date::option` (plus `#[serde(default)]`) on `Option<Timestamp>`, and `flex_date::map` on
/// `BTreeMap<String, Timestamp>` (Swift `[String: Date]`).
pub mod flex_date {
    use super::*;
    use serde::{Deserializer, Serializer, de::Error};
    use std::collections::BTreeMap;

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Number(f64),
        Text(String),
    }

    fn convert<E: Error>(raw: Raw) -> Result<Timestamp, E> {
        match raw {
            Raw::Number(n) => Ok(swift_date::to_timestamp(n)),
            Raw::Text(t) => t.parse::<Timestamp>().map_err(E::custom),
        }
    }

    pub fn serialize<S: Serializer>(ts: &Timestamp, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(ts)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Timestamp, D::Error> {
        convert(Raw::deserialize(d)?)
    }

    pub mod option {
        use super::*;

        pub fn serialize<S: Serializer>(ts: &Option<Timestamp>, s: S) -> Result<S::Ok, S::Error> {
            match ts {
                Some(ts) => s.collect_str(ts),
                None => s.serialize_none(),
            }
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Timestamp>, D::Error> {
            Option::<Raw>::deserialize(d)?.map(convert).transpose()
        }
    }

    pub mod map {
        use super::*;
        use serde::ser::SerializeMap;

        pub fn serialize<S: Serializer>(
            map: &BTreeMap<String, Timestamp>,
            s: S,
        ) -> Result<S::Ok, S::Error> {
            let mut out = s.serialize_map(Some(map.len()))?;
            for (k, v) in map {
                out.serialize_entry(k, &v.to_string())?;
            }
            out.end()
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(
            d: D,
        ) -> Result<BTreeMap<String, Timestamp>, D::Error> {
            BTreeMap::<String, Raw>::deserialize(d)?
                .into_iter()
                .map(|(k, v)| convert(v).map(|ts| (k, ts)))
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::date;

    #[test]
    fn seconds_round_trip_and_rounding() {
        let ts = from_secs(1_700_000_000.5);
        assert_eq!(secs(ts), 1_700_000_000.5);
        assert_eq!(secs(round_to_second(ts)), 1_700_000_001.0);
        assert_eq!(secs(floor_to_second(ts)), 1_700_000_000.0);
        assert_eq!(diff_secs(add_secs(ts, 90.0), ts), 90.0);
    }

    #[test]
    fn brussels_dst_days_have_real_lengths() {
        let cal = Cal::brussels();
        // 2026-03-29 has 23 hours, 2026-10-25 has 25 hours.
        assert_eq!(cal.date_interval(date(2026, 3, 29)).duration(), 23.0 * 3600.0);
        assert_eq!(cal.date_interval(date(2026, 10, 25)).duration(), 25.0 * 3600.0);
        let week = cal.week_interval(cal.date_at(date(2026, 10, 1), 12, 0));
        assert_eq!(cal.date(week.start), date(2026, 9, 28));
        assert_eq!(cal.swift_weekday(week.start), 2);
    }

    #[test]
    fn wire_dates_parse_offsets_and_local_values() {
        let cal = Cal::brussels();
        let utc = wire_date::parse("2026-09-29T08:00:00Z", None).unwrap();
        let local = wire_date::parse("2026-09-29T10:00:00", Some(cal.tz())).unwrap();
        let fraction = wire_date::parse("2026-09-29T10:00:00.1234567", Some(cal.tz())).unwrap();
        assert_eq!(utc, local);
        assert!(diff_secs(fraction, local) > 0.12 && diff_secs(fraction, local) < 0.13);
        assert_eq!(wire_date::local_string(utc, cal.tz()), "2026-09-29T10:00:00");
        assert_eq!(wire_date::parse("garbage", None), None);
    }

    #[test]
    fn swift_reference_dates() {
        let ts = swift_date::to_timestamp(0.0);
        assert_eq!(wire_date::utc_string(ts), "2001-01-01T00:00:00Z");
    }

    #[test]
    fn flex_dates_read_swift_numbers_and_write_rfc3339() {
        #[derive(Serialize, Deserialize, PartialEq, Debug)]
        struct Probe {
            #[serde(with = "flex_date")]
            at: Timestamp,
            #[serde(default, with = "flex_date::option")]
            maybe: Option<Timestamp>,
        }
        let legacy: Probe = serde_json::from_str(r#"{"at": 0}"#).unwrap();
        assert_eq!(wire_date::utc_string(legacy.at), "2001-01-01T00:00:00Z");
        assert_eq!(legacy.maybe, None);
        let json = serde_json::to_string(&legacy).unwrap();
        assert_eq!(json, r#"{"at":"2001-01-01T00:00:00Z","maybe":null}"#);
        assert_eq!(serde_json::from_str::<Probe>(&json).unwrap(), legacy);
    }
}

import Foundation

public struct BelgianHoliday: Identifiable, Equatable, Sendable {
    public let date: Date
    public let name: String
    public var id: Date { date }
    public static func all(in year: Int, calendar source: Calendar = .current) -> [Self] {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = source.timeZone
        guard (1583...9999).contains(year) else { return [] }
        func date(_ month: Int, _ day: Int) -> Date { calendar.date(from: DateComponents(year: year, month: month, day: day))! }
        // Gregorian computus. Store civil dates, never fixed 24-hour offsets across DST.
        let a = year % 19, b = year / 100, c = year % 100, d = b / 4, e = b % 4
        let f = (b + 8) / 25, g = (b - f + 1) / 3
        let h = (19 * a + b - d - g + 15) % 30, i = c / 4, k = c % 4
        let l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451
        let easter = date((h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1)
        var days = [(date(1, 1), "New Year’s Day"), (date(5, 1), "Labour Day"), (date(7, 21), "Belgian National Day"),
                    (date(8, 15), "Assumption"), (date(11, 1), "All Saints’ Day"), (date(11, 11), "Armistice Day"), (date(12, 25), "Christmas Day")]
        for (offset, name) in [(1, "Easter Monday"), (39, "Ascension Day"), (50, "Whit Monday")] {
            days.append((calendar.date(byAdding: .day, value: offset, to: easter)!, name))
        }
        return days.map { Self(date: $0.0, name: $0.1) }.sorted { $0.date < $1.date }
    }
}

public enum TargetExceptionKind: String, Codable, CaseIterable, Sendable {
    case leave = "Full-day leave", halfDay = "Half-day leave", replacement = "Replacement holiday", custom = "Custom target"
}
public struct TargetException: Codable, Identifiable, Equatable, Sendable {
    public var id: String // Gregorian yyyy-MM-dd in the user's local calendar timezone.
    public var kind: TargetExceptionKind
    public var hours: Double
    public var note: String
    public init(date: Date, kind: TargetExceptionKind, hours: Double = 0, note: String = "", calendar: Calendar = .current) {
        id = Self.key(date, calendar: calendar); self.kind = kind; self.hours = hours; self.note = note
    }
    public static func key(_ date: Date, calendar source: Calendar = .current) -> String {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = source.timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
    public var isValid: Bool {
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let date = formatter.date(from: id), formatter.string(from: date) == id else { return false }
        return hours.isFinite && (0...24).contains(hours)
    }
}

extension WorkTargets {
    public var usesBelgianHolidays: Bool {
        get { belgianHolidaysEnabled ?? true }
        set { belgianHolidaysEnabled = newValue }
    }
    public var exceptions: [TargetException] {
        get { dateExceptions ?? [] }
        set { dateExceptions = newValue }
    }
    public func reason(on date: Date, calendar: Calendar = .current) -> String? {
        if let item = exceptions.first(where: { $0.id == TargetException.key(date, calendar: calendar) }) { return item.kind.rawValue + (item.note.isEmpty ? "" : " · " + item.note) }
        guard usesBelgianHolidays else { return nil }
        return BelgianHoliday.all(in: Int(TargetException.key(date, calendar: calendar).prefix(4))!, calendar: calendar)
            .first { calendar.isDate($0.date, inSameDayAs: date) }?.name
    }
    public func seconds(in interval: DateInterval, calendar: Calendar = .current) -> Double {
        var day = calendar.startOfDay(for: interval.start), total = 0.0
        while day < interval.end {
            let next = calendar.date(byAdding: .day, value: 1, to: day)!
            total += dailySeconds(on: day, calendar: calendar) * max(0, min(next, interval.end).timeIntervalSince(max(day, interval.start))) / next.timeIntervalSince(day)
            day = next
        }
        return total
    }
}

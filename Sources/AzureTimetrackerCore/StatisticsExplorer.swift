import Foundation

/// All explorer intervals are half-open. Zoom is bounded by the downloaded period.
public enum StatisticsZoom {
    public static let minimum: TimeInterval = 15 * 60
    public static func bounded(_ proposed: DateInterval, within bounds: DateInterval) -> DateInterval {
        let duration = min(bounds.duration, max(minimum, proposed.duration))
        let start = max(bounds.start, min(proposed.start, bounds.end.addingTimeInterval(-duration)))
        return DateInterval(start: start, duration: duration)
    }
    public static func scaled(_ window: DateInterval, factor: Double, within bounds: DateInterval) -> DateInterval {
        guard factor.isFinite, factor > 0 else { return window }
        let duration = min(bounds.duration, max(minimum, window.duration * factor))
        return bounded(DateInterval(start: window.start.addingTimeInterval((window.duration - duration) / 2), duration: duration), within: bounds)
    }
    public static func shifted(_ window: DateInterval, direction: Int, within bounds: DateInterval) -> DateInterval {
        bounded(DateInterval(start: window.start.addingTimeInterval(window.duration * Double(direction)), duration: window.duration), within: bounds)
    }
}

public enum ExplorerResolution: String, Sendable {
    case month = "Monthly", day = "Daily", hour = "Hourly", quarter = "15 minutes", minute = "5 minutes"
    public static func forDuration(_ seconds: Double) -> Self {
        if seconds > 100 * 86400 { return .month }
        if seconds > 36 * 3600 { return .day }
        if seconds > 6 * 3600 { return .hour }
        if seconds > 3600 { return .quarter }
        return .minute
    }
    func interval(at date: Date, calendar: Calendar) -> DateInterval {
        switch self {
        case .month: return calendar.dateInterval(of: .month, for: date)!
        case .day: return calendar.dateInterval(of: .day, for: date)!
        case .hour: return calendar.dateInterval(of: .hour, for: date)!
        case .quarter, .minute:
            let hour = calendar.dateInterval(of: .hour, for: date)!.start
            let step = self == .quarter ? 900.0 : 300.0
            return DateInterval(start: hour.addingTimeInterval(floor(date.timeIntervalSince(hour) / step) * step), duration: step)
        }
    }
}

public struct ExplorerFilter: Equatable, Sendable {
    public var query = ""
    public var activityID: String?
    public var taskID: String?
    public var weekday: Int?
    public var lengthBand: Int?
    public init() {}
    public var isActive: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || activityID != nil || taskID != nil || weekday != nil || lengthBand != nil }
}

public struct ExplorerRecord: Identifiable, Sendable {
    public var id: String { log.id }
    public let log: WorkLog
    public let start: Date
    public let end: Date
    public let taskID: String
    public let ticketID: Int?
    public let activityID: String
    public let activityName: String
    public var fallbackTitle: String { ticketID.map { "Azure ticket #" + String($0) } ?? log.comment?.nonEmpty ?? activityName }
    public var lengthBand: Int { Self.band(log.length) }
    public static func band(_ seconds: Double) -> Int {
        if seconds < 900 { return 0 }; if seconds < 1800 { return 1 }
        if seconds < 3600 { return 2 }; if seconds < 7200 { return 3 }; return 4
    }
    public static let bandNames = ["Under 15 min", "15–30 min", "30–60 min", "1–2 hours", "2+ hours"]
}

public struct ExplorerEntry: Identifiable, Sendable {
    public var id: String { record.id + ":" + String(start.timeIntervalSince1970) }
    public let record: ExplorerRecord
    public let start: Date
    public let end: Date
    public var seconds: Double { end.timeIntervalSince(start) }
    public var clipped: Bool { start != record.start || end != record.end }
}
public struct ExplorerTask: Identifiable, Sendable {
    public let id: String
    public let ticketID: Int?
    public let title: String
    public let seconds: Double
    public let count: Int
    public let days: Int
    public let lastWorked: Date
}
public struct ExplorerActivity: Identifiable, Sendable {
    public let id: String
    public let name: String
    public let seconds: Double
    public init(id: String, name: String, seconds: Double) { self.id = id; self.name = name; self.seconds = seconds }
}
public struct ExplorerSegment: Identifiable, Sendable {
    public var id: String { activityID }
    public let activityID: String
    public let name: String
    public let bottom: Double
    public let top: Double
}
public struct ExplorerBucket: Identifiable, Sendable {
    public var id: Date { start }
    public let start: Date
    public let end: Date
    public let segments: [ExplorerSegment]
    public var seconds: Double { segments.last?.top ?? 0 }
    public var interval: DateInterval { DateInterval(start: start, end: end) }
}
public struct ExplorerPattern: Identifiable, Sendable {
    public let id: Int
    public let label: String
    public let seconds: Double
    public let count: Int
}

/// Dates are parsed once on download; filtering never reparses the API payload.
public struct ExplorerDataset: Sendable {
    public let records: [ExplorerRecord]
    public let omitted: Int
    public init(logs: [WorkLog]) {
        var seen = Set<String>(), parsed: [ExplorerRecord] = [], invalid = 0
        for log in logs where seen.insert(log.id).inserted {
            guard let start = log.date, log.length.isFinite, log.length >= 0, log.length <= Double(Int32.max) else { invalid += 1; continue }
            guard log.length > 0 else { continue }
            let ticket = log.workItemId.flatMap { $0 > 0 ? $0 : nil }
            let activity = log.activityType?.id.nonEmpty.map { "activity:" + $0 } ?? "unspecified"
            // Length prefixes keep free-text comments and activity IDs from colliding.
            let comment = log.comment?.nonEmpty ?? ""
            let key = ticket.map { "ticket:" + String($0) } ?? "free:\(activity.utf8.count):\(activity)\(comment)"
            parsed.append(ExplorerRecord(log: log, start: start, end: start.addingTimeInterval(log.length), taskID: key, ticketID: ticket,
                                         activityID: activity, activityName: log.activityType?.name?.nonEmpty ?? "Unspecified activity"))
        }
        records = parsed.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }; omitted = invalid
    }
    public func analyze(window: DateInterval, filter: ExplorerFilter = ExplorerFilter(), titles: [Int: String] = [:],
                        targets: WorkTargets = WorkTargets(), calendar: Calendar = .current, now: Date = Date(), resolution: ExplorerResolution? = nil) -> ExplorerAnalysis {
        var entries: [ExplorerEntry] = []
        let query = filter.query.trimmingCharacters(in: .whitespacesAndNewlines)
        for record in records where record.start < window.end && record.end > window.start {
            if let id = filter.activityID, record.activityID != id { continue }
            if let id = filter.taskID, record.taskID != id { continue }
            if let band = filter.lengthBand, record.lengthBand != band { continue }
            if !query.isEmpty {
                let haystack = [record.ticketID.map(String.init) ?? "", record.ticketID.flatMap { titles[$0] } ?? "", record.log.comment ?? "", record.activityName].joined(separator: " ")
                if haystack.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) == nil { continue }
            }
            var start = max(window.start, record.start)
            let end = min(window.end, record.end)
            while start < end {
                let next = min(end, calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: start))!)
                if filter.weekday == nil || calendar.component(.weekday, from: start) == filter.weekday {
                    entries.append(ExplorerEntry(record: record, start: start, end: next))
                }
                start = next
            }
        }
        entries.sort { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
        return ExplorerAnalysis(entries: entries, window: window, titles: titles, targets: targets, calendar: calendar, now: now, resolution: resolution)
    }
}

public struct ExplorerAnalysis: Sendable {
    public let entries: [ExplorerEntry]
    public let window: DateInterval
    public let tasks: [ExplorerTask]
    public let activities: [ExplorerActivity]
    public let buckets: [ExplorerBucket]
    public let weekdays: [ExplorerPattern]
    public let hours: [ExplorerPattern]
    public let lengths: [ExplorerPattern]
    public let resolution: ExplorerResolution
    public let total: Double
    public let covered: Double
    public var overlap: Double { max(0, total - covered) }
    public let count: Int
    public let trackedDays: Int
    public let median: Double
    public let billable: Double
    public let billableKnownCount: Int
    public let target: Double
    public let context: ContextInsights

    init(entries: [ExplorerEntry], window: DateInterval, titles: [Int: String], targets: WorkTargets, calendar: Calendar, now: Date, resolution chosenResolution: ExplorerResolution? = nil) {
        self.entries = entries; self.window = window
        total = entries.reduce(0) { $0 + $1.seconds }
        let byLog = Dictionary(grouping: entries, by: { $0.record.id })
        count = byLog.count
        trackedDays = Set(entries.map { calendar.startOfDay(for: $0.start) }).count
        let durations = byLog.values.map { $0.reduce(0) { $0 + $1.seconds } }.sorted()
        median = durations.isEmpty ? 0 : (durations[(durations.count - 1) / 2] + durations[durations.count / 2]) / 2
        var coverage = 0.0, lastEnd = window.start
        for entry in entries { coverage += max(0, entry.end.timeIntervalSince(max(lastEnd, entry.start))); lastEnd = max(lastEnd, entry.end) }
        covered = coverage
        billable = entries.reduce(0) { sum, entry in
            guard let billable = entry.record.log.billableLength, billable.isFinite, billable >= 0 else { return sum }
            return sum + min(billable, entry.record.log.length) * entry.seconds / entry.record.log.length
        }
        billableKnownCount = byLog.values.filter { parts in
            guard let value = parts.first?.record.log.billableLength else { return false }; return value.isFinite && value >= 0
        }.count
        tasks = Dictionary(grouping: entries, by: { $0.record.taskID }).map { id, parts in
            let record = parts[0].record
            return ExplorerTask(id: id, ticketID: record.ticketID, title: record.ticketID.flatMap { titles[$0] } ?? record.fallbackTitle,
                                seconds: parts.reduce(0) { $0 + $1.seconds }, count: Set(parts.map { $0.record.id }).count,
                                days: Set(parts.map { calendar.startOfDay(for: $0.start) }).count, lastWorked: parts.map(\.end).max()!)
        }.sorted { $0.seconds == $1.seconds ? $0.id < $1.id : $0.seconds > $1.seconds }
        activities = Dictionary(grouping: entries, by: { $0.record.activityID }).map { id, parts in
            ExplorerActivity(id: id, name: parts[0].record.activityName, seconds: parts.reduce(0) { $0 + $1.seconds })
        }.sorted { $0.seconds == $1.seconds ? $0.id < $1.id : $0.seconds > $1.seconds }
        resolution = chosenResolution ?? .forDuration(window.duration)
        var bucketList: [ExplorerBucket] = [], cursor = window.start
        while cursor < window.end {
            let next = min(window.end, resolution.interval(at: cursor, calendar: calendar).end)
            var totals: [String: Double] = [:]
            for entry in entries where entry.start < next && entry.end > cursor {
                totals[entry.record.activityID, default: 0] += min(next, entry.end).timeIntervalSince(max(cursor, entry.start))
            }
            var accumulated = 0.0, segments: [ExplorerSegment] = []
            for activity in activities.sorted(by: { $0.id < $1.id }) {
                guard let value = totals[activity.id], value > 0 else { continue }
                segments.append(ExplorerSegment(activityID: activity.id, name: activity.name, bottom: accumulated, top: accumulated + value)); accumulated += value
            }
            bucketList.append(ExplorerBucket(start: cursor, end: next, segments: segments)); cursor = next
        }
        buckets = bucketList
        var days: [Int: Double] = [:], occurrences: [Int: Int] = [:], targetTotal = 0.0
        cursor = calendar.startOfDay(for: window.start)
        while cursor < window.end {
            let next = calendar.date(byAdding: .day, value: 1, to: cursor)!
            if cursor <= now { occurrences[calendar.component(.weekday, from: cursor), default: 0] += 1 }
            if targets.isValid { targetTotal += targets.dailySeconds(on: cursor, calendar: calendar) }
            cursor = next
        }
        target = targetTotal
        var hourTotals: [Int: Double] = [:]
        for entry in entries {
            days[calendar.component(.weekday, from: entry.start), default: 0] += entry.seconds
            var position = entry.start
            while position < entry.end {
                let next = min(entry.end, calendar.dateInterval(of: .hour, for: position)!.end)
                hourTotals[calendar.component(.hour, from: position), default: 0] += next.timeIntervalSince(position); position = next
            }
        }
        weekdays = [2, 3, 4, 5, 6, 7, 1].map { ExplorerPattern(id: $0, label: calendar.shortWeekdaySymbols[$0 - 1], seconds: days[$0] ?? 0, count: occurrences[$0] ?? 0) }
        hours = (0..<24).map { ExplorerPattern(id: $0, label: String(format: "%02d:00", $0), seconds: hourTotals[$0] ?? 0, count: 0) }
        lengths = (0..<5).map { band in
            let parts = entries.filter { $0.record.lengthBand == band }
            return ExplorerPattern(id: band, label: ExplorerRecord.bandNames[band], seconds: parts.reduce(0) { $0 + $1.seconds }, count: Set(parts.map { $0.record.id }).count)
        }
        // Clipped copies preserve existing switch rules while respecting every explorer filter.
        let contextLogs = entries.map { entry -> WorkLog in
            var log = entry.record.log; log.id = entry.id; log.timestamp = WireDate.localString(entry.start); log.length = entry.seconds; return log
        }
        var contextDays: [ContextDay] = [], ambiguous = 0
        var year = StatisticsRange(period: .year, anchor: window.start, calendar: calendar)
        while year.start < window.end {
            let part = ContextInsights.calculate(logs: contextLogs, range: year, calendar: calendar, now: now)
            contextDays += part.days.filter { $0.date < window.end && calendar.date(byAdding: .day, value: 1, to: $0.date)! > window.start }
            ambiguous += part.ambiguousEntries; year = year.shifted(1, calendar: calendar)
        }
        context = ContextInsights(days: contextDays, ambiguousEntries: ambiguous)
    }
}

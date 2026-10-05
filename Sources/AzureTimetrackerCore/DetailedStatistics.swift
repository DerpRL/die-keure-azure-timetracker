import Foundation

public struct StatisticsBucket: Identifiable, Sendable {
    public var id: Date { start }
    public let start: Date
    public let end: Date
    public var seconds = 0.0
    public var targetSeconds = 0.0
}
public struct WeekdayStatistics: Identifiable, Sendable {
    public var id: Int { weekday }
    public let weekday: Int
    public var seconds = 0.0
    public var days = 0
    public var average: Double { days > 0 ? seconds / Double(days) : 0 }
}
public struct SessionLengthStatistics: Identifiable, Sendable {
    public var id: String { label }
    public let label: String
    public var count = 0
}
public struct StatisticsTimelineEntry: Identifiable, Sendable {
    public let id: String
    public let start: Date
    public let end: Date
    public let title: String
    public let activity: String
}
public struct DetailedStatistics: Sendable {
    public let buckets: [StatisticsBucket]
    public let weekdays: [WeekdayStatistics]
    public let lengths: [SessionLengthStatistics]
    public let timeline: [StatisticsTimelineEntry]
    public let billableSeconds: Double
    public let billableKnownCount: Int
    public let medianSeconds: Double
    public let targetDaysReached: Int
    public let elapsedTargetDays: Int
    public let omittedTimelineEntries: Int

    public static func calculate(logs: [WorkLog], summary: ActivityStatistics, calendar: Calendar = .current, now: Date = Date()) -> Self {
        let range = summary.range
        let component: Calendar.Component = range.period == .day ? .hour : range.period == .year ? .month : .day
        var buckets: [StatisticsBucket] = [], cursor = range.start
        while cursor < range.end {
            let end = calendar.date(byAdding: component, value: 1, to: cursor)!
            buckets.append(StatisticsBucket(start: cursor, end: min(end, range.end))); cursor = end
        }
        if range.period != .day {
            for day in summary.days {
                if let index = buckets.firstIndex(where: { day.date >= $0.start && day.date < $0.end }) {
                    buckets[index].seconds += day.seconds; buckets[index].targetSeconds += day.targetSeconds
                }
            }
        }
        var weekdays = [2, 3, 4, 5, 6, 7, 1].map { WeekdayStatistics(weekday: $0) }
        for day in summary.days where day.date <= calendar.startOfDay(for: now) {
            let index = (calendar.component(.weekday, from: day.date) + 5) % 7
            weekdays[index].days += 1; weekdays[index].seconds += day.seconds
        }
        var lengths = ["< 15m", "15–30m", "30–60m", "1–2h", "2h+"].map { SessionLengthStatistics(label: $0) }
        var seen = Set<String>(), durations: [Double] = [], timeline: [StatisticsTimelineEntry] = []
        var billable = 0.0, known = 0, omitted = 0
        for log in logs where seen.insert(log.id).inserted {
            guard let start = log.date, start >= range.start, start < range.end, log.length.isFinite, log.length >= 0 else { continue }
            durations.append(log.length)
            let index = log.length < 900 ? 0 : log.length < 1800 ? 1 : log.length < 3600 ? 2 : log.length < 7200 ? 3 : 4
            lengths[index].count += 1
            if let value = log.billableLength, value.isFinite, value >= 0, value <= log.length { billable += value; known += 1 }
            guard log.length <= Double(Int32.max) else { omitted += 1; continue }
            let end = min(start.addingTimeInterval(log.length), range.end)
            if range.period == .day {
                for index in buckets.indices {
                    buckets[index].seconds += max(0, min(end, buckets[index].end).timeIntervalSince(max(start, buckets[index].start)))
                }
                if end > start {
                    timeline.append(StatisticsTimelineEntry(id: log.id, start: start, end: end,
                        title: log.workItemId.flatMap { $0 > 0 ? "#\($0)" : nil } ?? log.comment?.nonEmpty ?? "No ticket",
                        activity: log.activityType?.name?.nonEmpty ?? "Unspecified"))
                }
            }
        }
        durations.sort()
        let median = durations.isEmpty ? 0 : durations.count.isMultiple(of: 2) ? (durations[durations.count / 2 - 1] + durations[durations.count / 2]) / 2 : durations[durations.count / 2]
        let targetDays = summary.days.filter { $0.targetSeconds > 0 && $0.date <= calendar.startOfDay(for: now) }
        return Self(buckets: buckets, weekdays: weekdays, lengths: lengths, timeline: timeline.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start },
            billableSeconds: billable, billableKnownCount: known, medianSeconds: median,
            targetDaysReached: targetDays.filter { $0.seconds >= $0.targetSeconds }.count, elapsedTargetDays: targetDays.count, omittedTimelineEntries: omitted)
    }
}

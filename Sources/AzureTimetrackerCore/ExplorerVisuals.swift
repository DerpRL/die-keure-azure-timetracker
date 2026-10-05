import Foundation

public struct ExplorerCalendarDay: Identifiable, Sendable {
    public var id: Date { date }
    public let date: Date
    public let interval: DateInterval
    public let seconds: Double
    public let entries: Int
    public let target: Double
    public let week: Int
    public let weekday: Int // Monday = 0
    public let future: Bool
}
public struct ExplorerHeatHour: Identifiable, Sendable {
    public var id: Date { interval.start }
    public let interval: DateInterval
    public let day: Date
    public let seconds: Double
    public let slot: Int // Chronological hour, including a repeated DST hour as a separate slot.
}
public struct ExplorerProgressPoint: Identifiable, Sendable {
    public var id: Date { date }
    public let date: Date
    public let seconds: Double
    public let target: Double
}

/// Derives graph data from the same filtered, clipped entries as the explorer totals.
public struct ExplorerVisuals: Sendable {
    public let days: [ExplorerCalendarDay]
    public let hours: [ExplorerHeatHour]
    public let progress: [ExplorerProgressPoint]
    public let targetProgress: [ExplorerProgressPoint]
    public let weekCount: Int

    public init(analysis: ExplorerAnalysis, targets: WorkTargets, calendar: Calendar = .current, now: Date = Date()) {
        let window = analysis.window
        let firstDay = calendar.startOfDay(for: window.start)
        let firstWeek = TargetProgress.weekInterval(at: firstDay, calendar: calendar).start
        let grouped = Dictionary(grouping: analysis.entries) { calendar.startOfDay(for: $0.start) }
        var dates: [ExplorerCalendarDay] = [], cursor = firstDay, target = 0.0
        var targetPoints = [ExplorerProgressPoint(date: window.start, seconds: 0, target: 0)]
        while cursor < window.end {
            let end = calendar.date(byAdding: .day, value: 1, to: cursor)!
            let entries = grouped[cursor] ?? []
            let offset = calendar.dateComponents([.day], from: firstWeek, to: cursor).day!
            let schedule = targets.isValid ? targets.dailySeconds(on: cursor, calendar: calendar) : 0
            let interval = DateInterval(start: max(cursor, window.start), end: min(end, window.end))
            dates.append(ExplorerCalendarDay(date: cursor, interval: interval, seconds: entries.reduce(0) { $0 + $1.seconds },
                entries: Set(entries.map { $0.record.id }).count, target: schedule, week: offset / 7, weekday: offset % 7,
                future: cursor > now))
            target += schedule
            targetPoints.append(ExplorerProgressPoint(date: interval.end, seconds: 0, target: target))
            cursor = end
        }
        days = dates; weekCount = (dates.last?.week ?? 0) + 1; targetProgress = targetPoints
        var hourly: [ExplorerHeatHour] = []
        // Hour grids are readable at a day/week scale; long windows use the calendar heatmap.
        if dates.count <= 8 {
            for day in dates {
                var position = day.interval.start
                var slot = calendar.dateComponents([.hour], from: day.date, to: position).hour!
                while position < day.interval.end {
                    let end = min(day.interval.end, calendar.dateInterval(of: .hour, for: position)!.end)
                    let seconds = (grouped[day.date] ?? []).reduce(0.0) { sum, entry in
                        sum + max(0, min(end, entry.end).timeIntervalSince(max(position, entry.start)))
                    }
                    hourly.append(ExplorerHeatHour(interval: DateInterval(start: position, end: end), day: day.date, seconds: seconds, slot: slot))
                    position = end; slot += 1
                }
            }
        }
        hours = hourly
        var recorded = 0.0
        var points = [ExplorerProgressPoint(date: window.start, seconds: 0, target: 0)]
        let recordedThrough = min(window.end, max(window.start, max(now, analysis.entries.map(\.end).max() ?? window.start)))
        for bucket in analysis.buckets where bucket.start < recordedThrough {
            recorded += bucket.seconds
            points.append(ExplorerProgressPoint(date: min(bucket.end, recordedThrough), seconds: recorded, target: 0))
        }
        progress = points
    }
}

import Foundation

public enum StatisticsPeriod: String, CaseIterable, Identifiable, Sendable {
    case day = "Day", week = "Week", month = "Month", year = "Year"
    public var component: Calendar.Component {
        switch self { case .day: .day; case .week: .weekOfYear; case .month: .month; case .year: .year }
    }
    public var id: Self { self }
}

public struct StatisticsRange: Equatable, Hashable, Sendable {
    public let period: StatisticsPeriod
    public let start: Date
    public let end: Date
    public init(period: StatisticsPeriod, anchor: Date, calendar: Calendar = .current) {
        self.period = period
        let interval = period == .week ? TargetProgress.weekInterval(at: anchor, calendar: calendar)
            : calendar.dateInterval(of: period.component, for: anchor)!
        start = interval.start; end = interval.end
    }
    public func shifted(_ amount: Int, calendar: Calendar = .current) -> Self {
        Self(period: period, anchor: calendar.date(byAdding: period.component, value: amount, to: start)!, calendar: calendar)
    }
}

public struct StatisticsDay: Identifiable, Equatable, Sendable {
    public var id: Date { date }
    public let date: Date
    public var seconds = 0.0
    public var sessions = 0
    public let targetSeconds: Double
    public var cumulativeSeconds = 0.0
    public var cumulativeTarget = 0.0
}

public struct StatisticsActivity: Identifiable, Equatable, Sendable {
    public let id: String
    public var name: String
    public var seconds: Double
    public var sessions: Int
}

public struct StatisticsTicket: Identifiable, Equatable, Sendable {
    public var id: String { ticketID.map(String.init) ?? "unassigned" }
    public let ticketID: Int?
    public var seconds: Double
    public var sessions: Int
}

/// Uses the worklog's reported date, like History. Does not extrapolate a live timer.
public struct ActivityStatistics: Equatable, Sendable {
    public let range: StatisticsRange
    public let days: [StatisticsDay]
    public let activities: [StatisticsActivity]
    public let tickets: [StatisticsTicket]
    public let omittedLogs: Int
    public var totalSeconds: Double { days.reduce(0) { $0 + $1.seconds } }
    public var targetSeconds: Double { days.reduce(0) { $0 + $1.targetSeconds } }
    public var sessions: Int { days.reduce(0) { $0 + $1.sessions } }
    public var trackedDays: Int { days.filter { $0.seconds > 0 }.count }
    public var averageSeconds: Double { trackedDays > 0 ? totalSeconds / Double(trackedDays) : 0 }
    public var targetFraction: Double { targetSeconds > 0 ? totalSeconds / targetSeconds : 0 }

    public static func calculate(logs: [WorkLog], range: StatisticsRange, targets: WorkTargets = WorkTargets(),
                                 calendar: Calendar = .current) -> Self {
        var days: [StatisticsDay] = [], date = range.start
        while date < range.end {
            days.append(StatisticsDay(date: date, targetSeconds: targets.isValid ? targets.dailySeconds(on: date, calendar: calendar) : 0))
            date = calendar.date(byAdding: .day, value: 1, to: date)!
        }
        let indices = Dictionary(uniqueKeysWithValues: days.enumerated().map { ($0.element.date, $0.offset) })
        var seen = Set<String>(), activities: [String: StatisticsActivity] = [:], tickets: [String: StatisticsTicket] = [:]
        var omitted = 0
        for log in logs where seen.insert(log.id).inserted {
            guard let date = log.date, log.length.isFinite, log.length >= 0 else { omitted += 1; continue }
            // API bounds may be inclusive; never count the next period's midnight.
            guard date >= range.start, date < range.end else { continue }
            guard let index = indices[calendar.startOfDay(for: date)] else { continue }
            days[index].seconds += log.length; days[index].sessions += 1
            let activityID = log.activityType?.id.nonEmpty.map { "activity:" + $0 } ?? "unspecified"
            let name = log.activityType?.name?.nonEmpty ?? (log.activityType?.id.nonEmpty == nil ? "Unspecified activity" : "Unnamed activity")
            var activity = activities[activityID] ?? StatisticsActivity(id: activityID, name: name, seconds: 0, sessions: 0)
            if activity.name == "Unnamed activity", name != "Unnamed activity" { activity.name = name }
            activity.seconds += log.length; activity.sessions += 1; activities[activityID] = activity
            let ticketID = log.workItemId.flatMap { $0 > 0 ? $0 : nil }
            let key = ticketID.map(String.init) ?? "unassigned"
            var ticket = tickets[key] ?? StatisticsTicket(ticketID: ticketID, seconds: 0, sessions: 0)
            ticket.seconds += log.length; ticket.sessions += 1; tickets[key] = ticket
        }
        var tracked = 0.0, target = 0.0
        for index in days.indices {
            tracked += days[index].seconds; target += days[index].targetSeconds
            days[index].cumulativeSeconds = tracked; days[index].cumulativeTarget = target
        }
        return Self(range: range, days: days,
                    activities: activities.values.sorted { $0.seconds == $1.seconds ? $0.id < $1.id : $0.seconds > $1.seconds },
                    tickets: tickets.values.sorted { $0.seconds == $1.seconds ? $0.id < $1.id : $0.seconds > $1.seconds }, omittedLogs: omitted)
    }
}

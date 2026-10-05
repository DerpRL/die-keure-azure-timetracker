import Foundation

public struct WorkTargets: Codable, Equatable, Sendable {
    public var weeklyHours: Double = 38
    public var dailyHours: Double = 7.6
    // Sunday first, matching Calendar weekday values. Optional for older settings.
    public var hoursByWeekday: [Double]?
    public var belgianHolidaysEnabled: Bool?
    public var dateExceptions: [TargetException]?
    public init() {}
    public var weeklyTargetHours: Double { hoursByWeekday?.reduce(0, +) ?? weeklyHours }
    public func hours(weekday: Int) -> Double {
        guard (1...7).contains(weekday) else { return 0 }
        if let hoursByWeekday, hoursByWeekday.count == 7 { return hoursByWeekday[weekday - 1] }
        return [1, 7].contains(weekday) ? 0 : dailyHours
    }
    public mutating func setHours(_ hours: Double, weekday: Int) {
        guard (1...7).contains(weekday) else { return }
        var schedule = (1...7).map { self.hours(weekday: $0) }
        schedule[weekday - 1] = hours; hoursByWeekday = schedule
        weeklyHours = schedule.reduce(0, +)
    }
    public var isValid: Bool {
        guard exceptions.allSatisfy({ $0.isValid }), Set(exceptions.map(\.id)).count == exceptions.count else { return false }
        if let hoursByWeekday {
            return hoursByWeekday.count == 7 && hoursByWeekday.allSatisfy { $0.isFinite && (0...24).contains($0) }
        }
        return weeklyHours.isFinite && dailyHours.isFinite && (1...168).contains(weeklyHours) && (0.1...24).contains(dailyHours)
    }
    public func dailySeconds(on date: Date, calendar: Calendar) -> Double {
        let regular = hours(weekday: calendar.component(.weekday, from: date))
        if let item = exceptions.first(where: { $0.id == TargetException.key(date, calendar: calendar) }) {
            switch item.kind { case .leave, .replacement: return 0; case .halfDay: return regular * 1800; case .custom: return item.hours * 3600 }
        }
        if usesBelgianHolidays, reason(on: date, calendar: calendar) != nil { return 0 }
        return regular * 3600
    }
}

public struct TargetProgress: Equatable, Sendable {
    public var today: Double
    public var week: Double
    public static func weekInterval(at date: Date, calendar: Calendar = .current) -> DateInterval {
        var calendar = calendar; calendar.firstWeekday = 2; calendar.minimumDaysInFirstWeek = 4
        return calendar.dateInterval(of: .weekOfYear, for: date)!
    }
    public static func calculate(logs: [WorkLog], state: TrackingState?, lastSync: Date?, now: Date,
                                 extrapolate: Bool, calendar: Calendar = .current) -> Self {
        let day = calendar.dateInterval(of: .day, for: now)!
        let week = weekInterval(at: now, calendar: calendar)
        // Without a stable worklog ID, use reported worklogs only: adding the
        // live duration could count an already returned worklog twice.
        let active = state?.running == true && state?.track?.workLogId?.nonEmpty != nil ? state?.track : nil
        var todayTotal = 0.0, weekTotal = 0.0
        var seen = Set<String>()
        for log in logs where seen.insert(log.id).inserted && log.id != active?.workLogId {
            guard let date = log.date, log.length.isFinite else { continue }
            if date >= day.start && date < day.end { todayTotal += max(0, log.length) }
            if date >= week.start && date < week.end { weekTotal += max(0, log.length) }
        }
        if let active, let sync = lastSync {
            let seconds = max(0, active.currentTrackLength ?? 0)
            let end = extrapolate ? max(now, sync) : sync
            // Reconstruct the confirmed duration, then add only time since that confirmation.
            let start = sync.addingTimeInterval(-seconds)
            func overlap(_ interval: DateInterval) -> Double {
                max(0, min(end, interval.end).timeIntervalSince(max(start, interval.start)))
            }
            todayTotal += overlap(day); weekTotal += overlap(week)
        }
        return Self(today: todayTotal, week: weekTotal)
    }
}

public enum ConnectionHealth: Equatable, Sendable {
    case unconfigured, connecting, confirmed, stale, offline, authentication, accessDenied
    public static func resolve(configured: Bool, connecting: Bool, connected: Bool, lastSync: Date?,
                               failure: AppError?, now: Date, pollSeconds: Int) -> Self {
        if connecting { return .connecting }
        if case .authentication = failure { return .authentication }
        if case .accessDenied = failure { return .accessDenied }
        guard configured else { return .unconfigured }
        guard connected, let lastSync else { return .offline }
        return now.timeIntervalSince(lastSync) > max(90, Double(pollSeconds) * 2 + 15) ? .stale : .confirmed
    }
    public var label: String {
        switch self {
        case .unconfigured: "Not connected"
        case .connecting: "Connecting"
        case .confirmed: "Confirmed by 7pace"
        case .stale: "Status out of date"
        case .offline: "Connection lost"
        case .authentication: "Token needs attention"
        case .accessDenied: "Access denied"
        }
    }
    public var symbol: String {
        switch self {
        case .confirmed: "checkmark.shield.fill"
        case .connecting: "arrow.triangle.2.circlepath"
        case .authentication, .accessDenied: "key.fill"
        default: "exclamationmark.icloud"
        }
    }
}

/// Only the occurrence key and tracking identifiers are persisted, never calendar text.
public struct MeetingReturn: Codable, Equatable, Sendable {
    public var occurrenceID: String
    public var end: Date
    public var ticketID: Int
    public var activityID: String?
    public var workspace: String
    public var meetingIdentity: String
    public var notified = false
    public var microphoneAppID: String? = nil
    public var microphoneSessionID: String? = nil
    public var slackCallID: String? = nil
    public var slackTeamID: String? = nil
    public var slackWasJoined: Bool? = nil

    public static func afterStarting(meeting: MeetingEvent, previous: TrackingState, next: TrackingState,
                                     workspace: String, existing: Self?) -> Self? {
        guard previous.running, next.running else { return nil }
        let original = existing.flatMap { $0.workspace == workspace && $0.meetingIdentity == previous.identity ? $0 : nil }
        guard let ticket = original?.ticketID ?? previous.track?.tfsId.flatMap({ $0 > 0 ? $0 : nil }) else { return nil }
        if previous.identity == next.identity {
            guard var continued = original else { return nil }
            continued.occurrenceID = meeting.id; continued.end = meeting.end; continued.notified = false
            return continued
        }
        return Self(occurrenceID: meeting.id, end: meeting.end, ticketID: original?.ticketID ?? ticket,
                    activityID: original != nil ? original?.activityID : previous.track?.activityTypeId, workspace: workspace,
                    meetingIdentity: next.identity)
    }
    public func isValid(state: TrackingState?, workspace: String, now: Date) -> Bool {
        self.workspace == workspace && state?.running == true && state?.identity == meetingIdentity && now < end.addingTimeInterval(86400)
    }
    public func isDue(state: TrackingState?, workspace: String, now: Date) -> Bool {
        isValid(state: state, workspace: workspace, now: now) && now >= end
    }
}

public struct QuickTickets: Codable, Equatable, Sendable {
    public var workspace: String
    public var recent: [Int] = []
    public var favorites: [Int] = []
    public init(workspace: String) { self.workspace = workspace }
    public mutating func remember(_ id: Int) {
        recent.removeAll { $0 == id }; recent.insert(id, at: 0); recent = Array(recent.prefix(8))
    }
    public mutating func toggleFavorite(_ id: Int) {
        if favorites.contains(id) { favorites.removeAll { $0 == id } }
        else if favorites.count < 20 { favorites.append(id) }
    }
    public var orderedIDs: [Int] { favorites + recent.filter { !favorites.contains($0) } }
}

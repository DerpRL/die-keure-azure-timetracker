import Foundation

public struct DayReviewPreferences: Codable, Equatable, Sendable {
    public var enabled = true
    public var startMinute = 9 * 60
    public var finishMinute = 17 * 60
    public var weekdays = [2, 3, 4, 5, 6]
    public var longSessionMinutes = 180
    public var gapMinutes = 20
    public init() {}
    public var isValid: Bool {
        (0..<1440).contains(startMinute) && (0..<1440).contains(finishMinute) && startMinute < finishMinute &&
        !weekdays.isEmpty && weekdays.allSatisfy { (1...7).contains($0) } &&
        (30...720).contains(longSessionMinutes) && (5...180).contains(gapMinutes)
    }
    public func time(_ minute: Int, on day: Date, calendar: Calendar = .current) -> Date {
        calendar.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: day)!
    }
}

public struct DayReviewRecord: Codable, Equatable, Sendable {
    public var promptedAt: Date?
    public var snoozedUntil: Date?
    public var reviewedAt: Date?
    public init() {}
}

public enum DayReviewSchedule {
    public static func key(workspace: String, day: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: day)
        return workspace + "|\(c.year!)-\(c.month!)-\(c.day!)"
    }
    public static func isDue(now: Date, preferences: DayReviewPreferences, record: DayReviewRecord?, calendar: Calendar = .current) -> Bool {
        guard preferences.enabled, preferences.isValid, preferences.weekdays.contains(calendar.component(.weekday, from: now)),
              record?.reviewedAt == nil else { return false }
        if let snooze = record?.snoozedUntil { return now >= snooze }
        return now >= preferences.time(preferences.finishMinute, on: now, calendar: calendar) && record?.promptedAt == nil
    }
    public static func isPending(now: Date, record: DayReviewRecord?) -> Bool {
        guard record?.promptedAt != nil, record?.reviewedAt == nil else { return false }
        return record?.snoozedUntil.map { now >= $0 } ?? true
    }
}

public struct ReviewSession: Identifiable, Equatable, Sendable {
    public let id: String
    public let start: Date
    public let end: Date
    public let ticketID: Int?
    public let title: String
    public let activity: String
    public let isRunning: Bool
    public let isLong: Bool
    public var seconds: Double { max(0, end.timeIntervalSince(start)) }
}

public struct ReviewGap: Identifiable, Equatable, Sendable {
    public var id: Date { start }
    public let start: Date
    public let end: Date
    public var seconds: Double { end.timeIntervalSince(start) }
}

public struct DayReviewSummary: Equatable, Sendable {
    public let day: Date
    public let sessions: [ReviewSession]
    public let gaps: [ReviewGap]
    public let omittedLogs: Int
    public let gapsUnavailable: Bool
    public let timerRunning: Bool
    public let timerUnconfirmed: Bool
    public var totalSeconds: Double { sessions.reduce(0) { $0 + $1.seconds } }
    public var longSessions: [ReviewSession] { sessions.filter(\.isLong) }
    public var gapSeconds: Double { gaps.reduce(0) { $0 + $1.seconds } }

    public static func calculate(logs: [WorkLog], day: Date, now: Date, preferences: DayReviewPreferences,
                                 state: TrackingState?, confirmedAt: Date?, timerConfirmed: Bool,
                                 calendar: Calendar = .current) -> Self {
        let interval = calendar.dateInterval(of: .day, for: day)!
        let endOfData = min(interval.end, now)
        let today = calendar.isDate(day, inSameDayAs: now)
        let active = today && timerConfirmed && state?.running == true ? state?.track : nil
        let usableDuration = active?.currentTrackLength.map { $0.isFinite && $0 >= 0 } == true && confirmedAt != nil
        let activeID = usableDuration ? active?.workLogId?.nonEmpty : nil
        var sessions: [ReviewSession] = [], omitted = 0, seen = Set<String>(), unknownTiming = false
        for log in logs where seen.insert(log.id).inserted && log.id != activeID {
            guard let start = log.date, log.length.isFinite, log.length >= 0 else { omitted += 1; continue }
            let end = start.addingTimeInterval(log.length)
            guard start < endOfData, end > interval.start else { continue }
            // Midnight entries can represent manually assigned daily totals. Avoid claiming precise gaps from them.
            if calendar.startOfDay(for: start) == start { unknownTiming = true }
            sessions.append(ReviewSession(id: log.id, start: max(start, interval.start), end: min(end, endOfData),
                ticketID: log.workItemId.flatMap { $0 > 0 ? $0 : nil }, title: log.comment?.nonEmpty ?? "Work session",
                activity: log.activityType?.name?.nonEmpty ?? "Unspecified activity", isRunning: false,
                isLong: log.length >= Double(preferences.longSessionMinutes * 60)))
        }
        if let active, let id = activeID, let confirmedAt, let duration = active.currentTrackLength, duration.isFinite, duration >= 0 {
            // Reconstruct from confirmed elapsed time, never add speculative seconds after the last confirmation.
            let start = confirmedAt.addingTimeInterval(-duration), end = min(confirmedAt, endOfData)
            if end > interval.start, start < end {
                sessions.append(ReviewSession(id: id, start: max(start, interval.start), end: end,
                    ticketID: active.ticketID, title: active.title, activity: "Current activity", isRunning: true,
                    isLong: duration >= Double(preferences.longSessionMinutes * 60)))
            }
        } else if active != nil { unknownTiming = true }
        sessions.sort { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
        let timerUnconfirmed = today && !timerConfirmed
        let gapsUnavailable = unknownTiming || omitted > 0 || timerUnconfirmed
        var gaps: [ReviewGap] = []
        if preferences.isValid, preferences.weekdays.contains(calendar.component(.weekday, from: day)), !gapsUnavailable {
            let workStart = preferences.time(preferences.startMinute, on: day, calendar: calendar)
            // A confirmed running timer covers the remaining seconds since confirmation for gap detection only.
            let workEnd = min(preferences.time(preferences.finishMinute, on: day, calendar: calendar), endOfData)
            var cursor = workStart
            for session in sessions where session.seconds > 0 && session.end > workStart && session.start < workEnd {
                let start = max(session.start, workStart)
                if start.timeIntervalSince(cursor) >= Double(preferences.gapMinutes * 60) { gaps.append(ReviewGap(start: cursor, end: start)) }
                cursor = max(cursor, min(session.isRunning ? now : session.end, workEnd))
            }
            if workEnd.timeIntervalSince(cursor) >= Double(preferences.gapMinutes * 60) { gaps.append(ReviewGap(start: cursor, end: workEnd)) }
        }
        return Self(day: interval.start, sessions: sessions, gaps: gaps, omittedLogs: omitted,
                    gapsUnavailable: gapsUnavailable, timerRunning: today && state?.running == true && timerConfirmed,
                    timerUnconfirmed: timerUnconfirmed)
    }
}

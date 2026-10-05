import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct DayReviewTests {
    var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!; return c }
    func date(_ value: String) -> Date { WireDate.parse(value)! }
    var now: Date { date("2026-10-01T15:15:00Z") } // Thursday, 17:15 in Brussels.
    func log(_ id: String, start: String, hours: Double) -> WorkLog {
        WorkLog(id: id, timestamp: start, length: hours * 3600, workItemId: 33984)
    }
    func summary(_ logs: [WorkLog], state: TrackingState? = nil, confirmed: Bool = true, sync: Date? = nil) -> DayReviewSummary {
        .calculate(logs: logs, day: now, now: now, preferences: DayReviewPreferences(), state: state,
                   confirmedAt: sync ?? now, timerConfirmed: confirmed, calendar: calendar)
    }
    @Test func defaultReminderFiresAtLocalFinishTimeAndOnlyOnSelectedDays() {
        let prefs = DayReviewPreferences()
        #expect(prefs.isValid)
        #expect(!DayReviewSchedule.isDue(now: date("2026-10-01T14:59:59Z"), preferences: prefs, record: nil, calendar: calendar))
        #expect(DayReviewSchedule.isDue(now: date("2026-10-01T15:00:00Z"), preferences: prefs, record: nil, calendar: calendar))
        #expect(DayReviewSchedule.isDue(now: date("2026-10-01T20:00:00Z"), preferences: prefs, record: nil, calendar: calendar))
        #expect(!DayReviewSchedule.isDue(now: date("2026-10-03T15:00:00Z"), preferences: prefs, record: nil, calendar: calendar))
        var off = prefs; off.enabled = false
        #expect(!DayReviewSchedule.isDue(now: now, preferences: off, record: nil, calendar: calendar))
    }
    @Test func promptSnoozeAndCompletionSurviveRoundTrip() throws {
        var record = DayReviewRecord(); record.promptedAt = now
        #expect(!DayReviewSchedule.isDue(now: now, preferences: .init(), record: record, calendar: calendar))
        #expect(DayReviewSchedule.isPending(now: now, record: record))
        record.snoozedUntil = now.addingTimeInterval(1800)
        record = try JSONDecoder().decode(DayReviewRecord.self, from: JSONEncoder().encode(record))
        #expect(!DayReviewSchedule.isPending(now: now, record: record))
        #expect(!DayReviewSchedule.isDue(now: now.addingTimeInterval(1799), preferences: .init(), record: record, calendar: calendar))
        #expect(DayReviewSchedule.isDue(now: now.addingTimeInterval(1800), preferences: .init(), record: record, calendar: calendar))
        record.reviewedAt = now
        #expect(!DayReviewSchedule.isPending(now: now.addingTimeInterval(1900), record: record))
        #expect(!DayReviewSchedule.isDue(now: now.addingTimeInterval(1900), preferences: .init(), record: record, calendar: calendar))
    }
    @Test func explicitMorningSnoozeDoesNotWaitUntilEvening() {
        let morning = date("2026-10-01T08:00:00Z")
        var record = DayReviewRecord(); record.promptedAt = morning; record.snoozedUntil = morning.addingTimeInterval(1800)
        #expect(DayReviewSchedule.isDue(now: morning.addingTimeInterval(1800), preferences: .init(), record: record, calendar: calendar))
    }
    @Test func reviewKeysIsolateWorkspacesAndLocalDays() {
        let first = DayReviewSchedule.key(workspace: "one", day: now, calendar: calendar)
        #expect(first == DayReviewSchedule.key(workspace: "one", day: date("2026-10-01T21:59:59Z"), calendar: calendar))
        #expect(first != DayReviewSchedule.key(workspace: "one", day: date("2026-10-01T22:00:00Z"), calendar: calendar))
        #expect(first != DayReviewSchedule.key(workspace: "two", day: now, calendar: calendar))
    }
    @Test func invalidPreferencesAreRejectedAndOldConfigurationKeepsDefaults() throws {
        var prefs = DayReviewPreferences(); prefs.finishMinute = prefs.startMinute
        #expect(!prefs.isValid)
        prefs = .init(); prefs.weekdays = []; #expect(!prefs.isValid)
        prefs = .init(); prefs.gapMinutes = 0; #expect(!prefs.isValid)
        let old = Configuration()
        let loaded = try JSONDecoder().decode(Configuration.self, from: JSONEncoder().encode(old))
        #expect(loaded.endOfDayReview == nil)
        #expect(loaded.dayReview.finishMinute == 1020)
    }
    @Test func gapsUseUnionOfOverlapsAndIgnoreDuplicateIDs() {
        let a = log("a", start: "2026-10-01T07:00:00Z", hours: 2)
        let b = log("b", start: "2026-10-01T08:00:00Z", hours: 3)
        let c = log("c", start: "2026-10-01T12:00:00Z", hours: 3)
        let result = summary([c, b, a, a])
        #expect(result.sessions.count == 3)
        #expect(result.gaps.count == 1)
        #expect(result.gaps.first?.start == date("2026-10-01T11:00:00Z"))
        #expect(result.gaps.first?.end == date("2026-10-01T12:00:00Z"))
        #expect(result.totalSeconds == 8 * 3600)
    }
    @Test func leadingTrailingAndMinimumGapsAreHandled() {
        let result = summary([log("a", start: "2026-10-01T08:00:00Z", hours: 2), log("b", start: "2026-10-01T10:10:00Z", hours: 3)])
        #expect(result.gaps.count == 2)
        #expect(result.gaps.first?.seconds == 3600.0)
        #expect(result.gaps.last?.end == date("2026-10-01T15:00:00Z"))
        #expect(result.gaps.allSatisfy { $0.seconds >= 20 * 60 })
        let empty = summary([])
        #expect(empty.gaps.count == 1 && empty.gapSeconds == 8 * 3600)
    }
    @Test func overnightAndLongEntriesAreClippedToTheReviewDay() {
        let result = summary([log("overnight", start: "2026-09-30T21:00:00Z", hours: 4), log("future", start: "2026-10-01T22:00:00Z", hours: 2)])
        #expect(result.sessions.count == 1)
        #expect(result.totalSeconds == 3 * 3600)
        #expect(result.sessions.first?.start == date("2026-09-30T22:00:00Z"))
        #expect(result.longSessions.count == 1)
    }
    @Test func midnightEntriesAndUnconfirmedTimersDisableGapClaims() {
        let midnight = summary([log("daily-total", start: "2026-09-30T22:00:00Z", hours: 7.6)])
        #expect(midnight.gapsUnavailable && midnight.gaps.isEmpty)
        let stale = summary([], confirmed: false)
        #expect(stale.timerUnconfirmed && stale.gaps.isEmpty)
        #expect(!stale.timerRunning)
    }
    @Test func activeTimerIsCountedOnceAndFrozenAtConfirmation() throws {
        var running = try state(33984, session: "active")
        running.track?.currentTrackLength = 7200
        let sync = now.addingTimeInterval(-60)
        let result = summary([log("active", start: "2026-10-01T13:14:00Z", hours: 1), log("other", start: "2026-10-01T07:00:00Z", hours: 1)], state: running, sync: sync)
        #expect(result.sessions.count == 2)
        #expect(result.totalSeconds == 10800)
        #expect(result.timerRunning)
        #expect(result.sessions.last?.end == sync)
        #expect(result.sessions.last?.isRunning == true)
    }
    @Test func MissingActiveDurationPreservesReportedWorklog() throws {
        var running = try state(33984, session: "active"); running.track?.currentTrackLength = nil
        let result = summary([log("active", start: "2026-10-01T13:00:00Z", hours: 1)], state: running)
        #expect(result.totalSeconds == 3600)
        #expect(result.gapsUnavailable)
    }
    @Test func malformedAndZeroEntriesDoNotInventCoveredTime() {
        let invalid = log("invalid", start: "unknown", hours: 2)
        let result = summary([invalid, log("negative", start: "2026-10-01T07:00:00Z", hours: -1)])
        #expect(result.omittedLogs == 2 && result.gapsUnavailable)
        let zero = summary([log("zero", start: "2026-10-01T10:00:00Z", hours: 0)])
        #expect(zero.gaps.count == 1 && zero.gapSeconds == 8 * 3600)
    }
    @Test func daylightSavingReminderUsesLocalClock() {
        var prefs = DayReviewPreferences(); prefs.weekdays = [1]
        #expect(!DayReviewSchedule.isDue(now: date("2026-10-25T15:59:59Z"), preferences: prefs, record: nil, calendar: calendar))
        #expect(DayReviewSchedule.isDue(now: date("2026-10-25T16:00:00Z"), preferences: prefs, record: nil, calendar: calendar))
    }
}

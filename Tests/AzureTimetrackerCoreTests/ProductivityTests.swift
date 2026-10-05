import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct TargetProgressTests {
    var calendar: Calendar {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!; return c
    }
    func date(_ text: String) -> Date { WireDate.parse(text)! }
    func log(_ id: String, _ timestamp: String, _ length: Double) throws -> WorkLog {
        try JSONDecoder().decode(WorkLog.self, from: Data("{\"id\":\"\(id)\",\"timestamp\":\"\(timestamp)\",\"length\":\(length)}".utf8))
    }
    @Test func targetDefaultsAndWeekend() {
        let targets = WorkTargets()
        #expect(targets.weeklyHours == 38)
        #expect(targets.dailySeconds(on: date("2026-09-29T10:00:00Z"), calendar: calendar) == 27360)
        #expect(targets.dailySeconds(on: date("2026-10-03T10:00:00Z"), calendar: calendar) == 0)
        var invalid = targets; invalid.weeklyHours = .infinity; #expect(!invalid.isValid)
        invalid = targets; invalid.dailyHours = 25; #expect(!invalid.isValid)
    }
    @Test func mondayWeekAndDaylightSavingUseCalendarBoundaries() {
        let interval = TargetProgress.weekInterval(at: date("2026-10-25T12:00:00Z"), calendar: calendar)
        #expect(interval.start == date("2026-10-18T22:00:00Z"))
        #expect(interval.end == date("2026-10-25T23:00:00Z"))
        #expect(interval.duration == 169 * 3600)
    }
    @Test func activeLogIsCountedOnceAndIdleLogIsNotDropped() throws {
        let now = date("2026-09-29T10:00:00Z")
        let logs = try [log("done", "2026-09-29T08:00:00Z", 1800), log("done", "2026-09-29T08:00:00Z", 1800), log("session", "2026-09-29T09:58:00Z", 120), log("monday", "2026-09-28T08:00:00Z", 3600), log("old", "2026-09-27T08:00:00Z", 900)]
        let active = TargetProgress.calculate(logs: logs, state: try state(100), lastSync: now.addingTimeInterval(-30), now: now, extrapolate: true, calendar: calendar)
        #expect(active.today == 1950)
        #expect(active.week == 5550)
        let idle = TargetProgress.calculate(logs: logs, state: try state(), lastSync: now, now: now, extrapolate: true, calendar: calendar)
        #expect(idle.today == 1920)
    }
    @Test func disconnectedTimeDoesNotGrow() throws {
        let sync = date("2026-09-29T10:00:00Z")
        let result = TargetProgress.calculate(logs: [], state: try state(100), lastSync: sync, now: sync.addingTimeInterval(3600), extrapolate: false, calendar: calendar)
        #expect(result.today == 120)
    }
    @Test func liveTimerCrossingMondayIsClippedToNewWeekAndDay() throws {
        let now = date("2026-09-27T22:01:00Z") // Monday 00:01 Brussels.
        let result = TargetProgress.calculate(logs: [], state: try state(100), lastSync: now, now: now, extrapolate: true, calendar: calendar)
        #expect(result.today == 60)
        #expect(result.week == 60)
    }
    @Test func completedLogAtExclusiveWeekEndIsNotIncluded() throws {
        let now = date("2026-09-29T10:00:00Z")
        let logs = try [log("next", "2026-10-04T22:00:00Z", 3600)]
        #expect(TargetProgress.calculate(logs: logs, state: nil, lastSync: nil, now: now, extrapolate: false, calendar: calendar).week == 0)
    }
    @Test func unidentifiedLiveTimerUsesReportedLogsWithoutDoubleCounting() throws {
        let now = date("2026-09-29T10:00:00Z")
        var unknown = try state(100); unknown.track?.workLogId = nil
        let logs = try [log("session", "2026-09-29T09:58:00Z", 120)]
        let result = TargetProgress.calculate(logs: logs, state: unknown, lastSync: now, now: now, extrapolate: true, calendar: calendar)
        #expect(result.today == 120)
    }
}

@Suite struct ConnectionHealthTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    @Test func staleStateAndPollingIntervals() {
        #expect(ConnectionHealth.resolve(configured: true, connecting: false, connected: true, lastSync: now.addingTimeInterval(-134), failure: nil, now: now, pollSeconds: 60) == .confirmed)
        #expect(ConnectionHealth.resolve(configured: true, connecting: false, connected: true, lastSync: now.addingTimeInterval(-136), failure: nil, now: now, pollSeconds: 60) == .stale)
        #expect(ConnectionHealth.resolve(configured: true, connecting: false, connected: true, lastSync: now.addingTimeInterval(-400), failure: nil, now: now, pollSeconds: 300) == .confirmed)
    }
    @Test func credentialsAndMissingConfirmationAreExplicit() {
        #expect(ConnectionHealth.resolve(configured: true, connecting: false, connected: false, lastSync: now, failure: .authentication("host"), now: now, pollSeconds: 60) == .authentication)
        #expect(ConnectionHealth.resolve(configured: true, connecting: false, connected: false, lastSync: now, failure: .accessDenied("host"), now: now, pollSeconds: 60) == .accessDenied)
        #expect(ConnectionHealth.resolve(configured: true, connecting: false, connected: true, lastSync: nil, failure: nil, now: now, pollSeconds: 60) == .offline)
        #expect(ConnectionHealth.resolve(configured: false, connecting: false, connected: false, lastSync: nil, failure: nil, now: now, pollSeconds: 60) == .unconfigured)
        #expect(ConnectionHealth.resolve(configured: true, connecting: true, connected: false, lastSync: now, failure: .authentication("host"), now: now, pollSeconds: 60) == .connecting)
    }
}

@Suite struct MeetingReturnTests {
    let end = Date(timeIntervalSince1970: 1_800_000_000)
    func meeting(_ id: String = "meeting") -> MeetingEvent { MeetingEvent(id: id, title: "Private meeting title", start: end.addingTimeInterval(-1800), end: end) }
    @Test func remembersPreviousWorkOnlyAfterARealSwitch() throws {
        let old = try state(100, activity: "development"), next = try state(200, session: "meeting-session", activity: "meeting")
        let plan = try #require(MeetingReturn.afterStarting(meeting: meeting(), previous: old, next: next, workspace: "org", existing: nil))
        #expect(plan.ticketID == 100); #expect(plan.activityID == "development")
        #expect(!plan.isDue(state: next, workspace: "org", now: end.addingTimeInterval(-1)))
        #expect(plan.isDue(state: next, workspace: "org", now: end))
        #expect(MeetingReturn.afterStarting(meeting: meeting(), previous: old, next: old, workspace: "org", existing: nil) == nil)
        #expect(try MeetingReturn.afterStarting(meeting: meeting(), previous: state(), next: next, workspace: "org", existing: nil) == nil)
    }
    @Test func manualSwitchStopExpiryAndWorkspaceChangeInvalidateReturn() throws {
        let next = try state(200, session: "meeting-session")
        let plan = try #require(MeetingReturn.afterStarting(meeting: meeting(), previous: state(100), next: next, workspace: "org", existing: nil))
        #expect(try !plan.isDue(state: state(), workspace: "org", now: end))
        #expect(try !plan.isDue(state: state(300), workspace: "org", now: end))
        #expect(!plan.isDue(state: next, workspace: "other", now: end))
        #expect(!plan.isDue(state: next, workspace: "org", now: end.addingTimeInterval(86400)))
    }
    @Test func consecutiveMeetingsPreserveOriginalTicketIncludingDefaultActivity() throws {
        let first = try state(200, session: "first", activity: "meeting")
        let second = try state(300, session: "second", activity: "meeting")
        let original = try #require(MeetingReturn.afterStarting(meeting: meeting(), previous: state(100), next: first, workspace: "org", existing: nil))
        let chained = try #require(MeetingReturn.afterStarting(meeting: meeting("second"), previous: first, next: second, workspace: "org", existing: original))
        #expect(chained.ticketID == 100); #expect(chained.activityID == nil)
        #expect(chained.meetingIdentity == second.identity)
    }
    @Test func restartPersistsReminderWithoutCalendarText() throws {
        let next = try state(200, session: "meeting-session")
        var plan = try #require(MeetingReturn.afterStarting(meeting: meeting(), previous: state(100), next: next, workspace: "org", existing: nil))
        plan.notified = true
        let data = try JSONEncoder().encode(plan)
        #expect(try JSONDecoder().decode(MeetingReturn.self, from: data) == plan)
        #expect(!String(decoding: data, as: UTF8.self).contains("Private meeting title"))
    }
    @Test func consecutiveMeetingsOnSameTicketAndActivityKeepReturn() throws {
        let current = try state(200, session: "meeting-session", activity: "meeting")
        let plan = try #require(MeetingReturn.afterStarting(meeting: meeting(), previous: state(100, activity: "dev"), next: current, workspace: "org", existing: nil))
        var later = meeting("second"); later.end = end.addingTimeInterval(1800)
        let continued = try #require(MeetingReturn.afterStarting(meeting: later, previous: current, next: current, workspace: "org", existing: plan))
        #expect(continued.ticketID == 100)
        #expect(continued.activityID == "dev")
        #expect(continued.end == later.end)
        #expect(continued.occurrenceID == "second")
    }
}

@Suite struct QuickTicketsTests {
    @Test func recentIsBoundedUniqueAndFavoritesAppearFirst() throws {
        var tickets = QuickTickets(workspace: "org")
        for id in 1...10 { tickets.remember(id) }
        tickets.remember(7); tickets.toggleFavorite(5)
        #expect(tickets.recent.count == 8)
        #expect(tickets.orderedIDs.first == 5)
        #expect(tickets.recent.first == 7)
        #expect(tickets.orderedIDs.filter { $0 == 5 }.count == 1)
        tickets.toggleFavorite(5); #expect(tickets.favorites.isEmpty)
        #expect(try JSONDecoder().decode(QuickTickets.self, from: JSONEncoder().encode(tickets)) == tickets)
    }
}

@Suite struct DailyScheduleTests {
    @Test func legacySettingsRetainTargetsAndConvertOnFirstEdit() throws {
        var targets = try JSONDecoder().decode(WorkTargets.self, from: Data(#"{"weeklyHours":38,"dailyHours":7.6}"#.utf8))
        #expect(targets.hoursByWeekday == nil && targets.weeklyTargetHours == 38)
        #expect(targets.hours(weekday: 2) == 7.6 && targets.hours(weekday: 1) == 0)
        targets.setHours(6, weekday: 6)
        #expect(targets.hoursByWeekday == [0, 7.6, 7.6, 7.6, 7.6, 6, 0])
        #expect(abs(targets.weeklyTargetHours - 36.4) < 0.0001)
        #expect(try JSONDecoder().decode(WorkTargets.self, from: JSONEncoder().encode(targets)) == targets)
    }
    @Test func customScheduleDrivesDailyWeeklyAndMonthlyCharts() {
        var targets = WorkTargets(); targets.hoursByWeekday = [0, 8, 8, 8, 8, 6, 0]
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!
        let anchor = WireDate.parse("2026-10-02T12:00:00Z")!
        #expect(targets.weeklyTargetHours == 38)
        #expect(targets.dailySeconds(on: anchor, calendar: c) == 21600)
        let week = ActivityStatistics.calculate(logs: [], range: StatisticsRange(period: .week, anchor: anchor, calendar: c), targets: targets, calendar: c)
        #expect(week.days.map(\.targetSeconds) == [28800,28800,28800,28800,21600,0,0])
        #expect(week.targetSeconds == 38 * 3600)
        let month = ActivityStatistics.calculate(logs: [], range: StatisticsRange(period: .month, anchor: anchor, calendar: c), targets: targets, calendar: c)
        #expect(month.targetSeconds == 166 * 3600)
        targets.setHours(2, weekday: 7)
        #expect(targets.weeklyTargetHours == 40)
        #expect(targets.dailySeconds(on: anchor.addingTimeInterval(86400), calendar: c) == 7200)
    }
    @Test func validatesEachDayAndAllowsDaysOff() {
        var t = WorkTargets(); t.hoursByWeekday = Array(repeating: 0, count: 7)
        #expect(t.isValid && t.weeklyTargetHours == 0)
        for value in [Double.nan, .infinity, -1, 24.1] {
            t.hoursByWeekday = [0, 8, 8, value, 8, 6, 0]; #expect(!t.isValid)
        }
        t.hoursByWeekday = [8]; #expect(!t.isValid)
        t.hoursByWeekday = Array(repeating: 24, count: 7); #expect(t.isValid)
    }
}

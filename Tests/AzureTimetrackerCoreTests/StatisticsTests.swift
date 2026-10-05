import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct StatisticsTests {
    var calendar: Calendar {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!; return c
    }
    func date(_ text: String) -> Date { WireDate.parse(text)! }
    func range(_ period: StatisticsPeriod = .week, _ anchor: String = "2026-09-30T10:00:00Z") -> StatisticsRange {
        StatisticsRange(period: period, anchor: date(anchor), calendar: calendar)
    }
    func log(_ id: String, _ timestamp: String = "2026-09-30T10:00:00Z", hours: Double = 1, ticket: Int? = nil, activity: ActivityType? = nil) -> WorkLog {
        WorkLog(id: id, timestamp: timestamp, length: hours * 3600, workItemId: ticket, activityType: activity)
    }
    func calculate(_ logs: [WorkLog], _ range: StatisticsRange? = nil, weekly: Double = 38) -> ActivityStatistics {
        var targets = WorkTargets(); targets.weeklyHours = weekly; targets.dailyHours = weekly / 5
        return .calculate(logs: logs, range: range ?? self.range(), targets: targets, calendar: calendar)
    }
    @Test func weekStartsOnMondayAndHandlesYearBoundary() {
        let r = range(.week, "2027-01-01T10:00:00Z")
        #expect(r.start == date("2026-12-27T23:00:00Z"))
        #expect(r.end == date("2027-01-03T23:00:00Z"))
        #expect(r.shifted(1, calendar: calendar).start == r.end)
        #expect(r.shifted(-1, calendar: calendar).end == r.start)
    }
    @Test func monthNavigationPreservesCalendarMonthsAndLeapDay() {
        let march = range(.month, "2028-03-31T10:00:00Z")
        let february = march.shifted(-1, calendar: calendar)
        #expect(february.start == date("2028-01-31T23:00:00Z"))
        #expect(february.end == date("2028-02-29T23:00:00Z"))
        #expect(calculate([], february).days.count == 29)
        #expect(february.shifted(1, calendar: calendar) == march)
    }
    @Test func daylightSavingDaysUseCalendarArithmetic() {
        let autumn = calculate([], range(.week, "2026-10-25T12:00:00Z"))
        #expect(autumn.range.end.timeIntervalSince(autumn.range.start) == 169 * 3600)
        #expect(autumn.days.count == 7)
        #expect(autumn.targetSeconds == 38 * 3600)
        let spring = calculate([], range(.week, "2026-03-29T12:00:00Z"))
        #expect(spring.range.end.timeIntervalSince(spring.range.start) == 167 * 3600)
        #expect(spring.days.count == 7)
    }
    @Test func monthTargetsUseWeekdaysRatherThanFourWeeks() {
        let result = calculate([], range(.month))
        #expect(result.days.count == 30)
        #expect(result.days.filter { $0.targetSeconds > 0 }.count == 22)
        #expect(abs(result.targetSeconds / 3600 - 167.2) < 0.0001)
        #expect(calculate([], range(.month), weekly: 40).targetSeconds == 176 * 3600)
    }
    @Test func missingDaysAreZeroAndAveragesOnlyUseTrackedDays() {
        let result = calculate([log("a", hours: 2), log("b", "2026-10-01T09:00:00Z", hours: 4)])
        #expect(result.days.count == 7)
        #expect(result.days.filter { $0.seconds == 0 }.count == 5)
        #expect(result.totalSeconds == 6 * 3600)
        #expect(result.averageSeconds == 3 * 3600)
        #expect(result.sessions == 2)
        #expect(result.days.last?.cumulativeSeconds == result.totalSeconds)
    }
    @Test func exclusiveEndAndDuplicateIDsNeverDoubleCount() {
        let logs = [log("first", "2026-09-27T22:00:00Z", hours: 2), log("first", "2026-09-27T22:00:00Z", hours: 2),
                    log("before", "2026-09-27T21:59:59Z"), log("end", "2026-10-04T22:00:00Z")]
        let result = calculate(logs)
        #expect(result.totalSeconds == 7200)
        #expect(result.sessions == 1)
        #expect(result.days[0].seconds == 7200)
    }
    @Test func ticketFreeStandupsAndUnknownActivitiesAreRetained() {
        let standup = ActivityType(id: "standup", name: "Standup")
        let development = ActivityType(id: "dev", name: "Development")
        let result = calculate([log("a", hours: 0.25, activity: standup), log("b", hours: 2, ticket: 33984, activity: development),
                                log("c", hours: 1, ticket: 0), log("d", hours: 1, ticket: 33984, activity: development)])
        #expect(result.activities.first?.name == "Development")
        #expect(result.activities.first?.seconds == 10800.0)
        #expect(result.activities.contains { $0.name == "Standup" && $0.seconds == 900 })
        #expect(result.activities.contains { $0.name == "Unspecified activity" })
        #expect(result.tickets.first?.id == "33984")
        #expect(result.tickets.first?.sessions == 2)
        #expect(result.tickets.last?.ticketID == nil)
        #expect(result.tickets.last?.seconds == 1.25 * 3600)
        #expect(result.activities.reduce(0) { $0 + $1.seconds } == result.totalSeconds)
        #expect(result.tickets.reduce(0) { $0 + $1.seconds } == result.totalSeconds)
    }
    @Test func activityIDsRemainDistinctWhenNamesMatch() {
        let result = calculate([log("a", activity: ActivityType(id: "one", name: "Meeting")),
                                log("b", activity: ActivityType(id: "two", name: "Meeting"))])
        #expect(result.activities.count == 2)
        #expect(Set(result.activities.map(\.id)).count == 2)
    }
    @Test func invalidValuesAreOmittedWithoutPoisoningTotals() {
        let result = calculate([log("invalid-date", "unknown"), log("negative", hours: -1), log("infinity", hours: .infinity),
                                log("nan", hours: .nan), log("valid", hours: 2), log("zero", hours: 0)])
        #expect(result.omittedLogs == 4)
        #expect(result.totalSeconds == 7200)
        #expect(result.sessions == 2)
        #expect(result.trackedDays == 1)
    }
    @Test func weekendsCountAsWorkButNeverAddTargetHours() {
        let result = calculate([log("weekend", "2026-10-03T10:00:00Z", hours: 40)])
        #expect(result.days[5].seconds == 40 * 3600)
        #expect(result.days[5].targetSeconds == 0)
        #expect(result.days[4].cumulativeTarget == result.days[6].cumulativeTarget)
        #expect(result.targetFraction > 1)
        let empty = calculate([])
        #expect(empty.averageSeconds == 0 && empty.targetFraction == 0 && empty.sessions == 0)
    }
}

import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct DetailedStatisticsTests {
    var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!; return c }
    func date(_ value: String) -> Date { WireDate.parse(value)! }
    func calculate(_ logs: [WorkLog], period: StatisticsPeriod = .day, anchor: String = "2026-10-02T12:00:00Z", now: String = "2026-10-02T18:00:00Z") -> (ActivityStatistics, DetailedStatistics) {
        let range = StatisticsRange(period: period, anchor: date(anchor), calendar: calendar)
        let summary = ActivityStatistics.calculate(logs: logs, range: range, calendar: calendar)
        return (summary, DetailedStatistics.calculate(logs: logs, summary: summary, calendar: calendar, now: date(now)))
    }
    @Test func dayRangeUsesCalendarBoundariesAcrossDST() {
        let range = StatisticsRange(period: .day, anchor: date("2026-10-25T12:00:00Z"), calendar: calendar)
        #expect(range.end.timeIntervalSince(range.start) == 25 * 3600)
        #expect(range.shifted(1, calendar: calendar).start == range.end)
        let (_, details) = calculate([], anchor: "2026-10-25T12:00:00Z")
        #expect(details.buckets.count == 25)
        let (_, spring) = calculate([], anchor: "2026-03-29T12:00:00Z")
        #expect(spring.buckets.count == 23)
    }
    @Test func yearRangeIncludesLeapDayAndTwelveMonths() {
        let (summary, details) = calculate([], period: .year, anchor: "2028-06-20T12:00:00Z")
        #expect(summary.days.count == 366)
        #expect(details.buckets.count == 12)
        #expect(summary.targetSeconds == details.buckets.reduce(0) { $0 + $1.targetSeconds })
        #expect(summary.range.shifted(1, calendar: calendar).start == summary.range.end)
    }
    @Test func hourlyBucketsSplitIntervalsAndKeepOverlappingReportedTime() {
        let logs = [WorkLog(id: "a", timestamp: "2026-10-02T07:30:00Z", length: 7200), WorkLog(id: "b", timestamp: "2026-10-02T08:00:00Z", length: 3600)]
        let (summary, details) = calculate(logs)
        #expect(summary.totalSeconds == 10800)
        #expect(details.buckets[9].seconds == 1800)
        #expect(details.buckets[10].seconds == 7200)
        #expect(details.buckets[11].seconds == 1800)
        #expect(details.timeline.count == 2)
    }
    @Test func midnightClippingIsExplicitAndDoesNotChangeReportedTotals() {
        let log = WorkLog(id: "late", timestamp: "2026-10-02T21:00:00Z", length: 7200)
        let (summary, details) = calculate([log])
        #expect(summary.totalSeconds == 7200)
        #expect(details.buckets.reduce(0) { $0 + $1.seconds } == 3600)
        #expect(details.timeline.first?.end == summary.range.end)
    }
    @Test func duplicateInvalidAndNextPeriodLogsAreExcluded() {
        let log = WorkLog(id: "one", timestamp: "2026-10-02T08:00:00Z", length: 3600)
        let (summary, details) = calculate([log, log, WorkLog(id: "invalid", timestamp: "oops", length: 3600), WorkLog(id: "end", timestamp: "2026-10-02T22:00:00Z", length: 3600)])
        #expect(summary.sessions == 1)
        #expect(details.lengths.reduce(0) { $0 + $1.count } == 1)
        #expect(details.timeline.count == 1)
    }
    @Test func weekdayAveragesIncludeZeroDaysAndExcludeFutureDates() {
        let (_, details) = calculate([WorkLog(id: "monday", timestamp: "2026-09-28T08:00:00Z", length: 7200)], period: .week, now: "2026-09-30T12:00:00Z")
        #expect(details.weekdays.map(\.days) == [1, 1, 1, 0, 0, 0, 0])
        #expect(details.weekdays[0].average == 7200)
        #expect(details.elapsedTargetDays == 3)
    }
    @Test func durationBoundariesMedianAndBillableAvailability() throws {
        let durations: [Double] = [0, 899, 900, 1800, 3600, 7200]
        let logs = durations.enumerated().map { WorkLog(id: String($0.offset), timestamp: "2026-10-02T08:00:00Z", length: $0.element, billableLength: $0.offset == 4 ? 3600 : nil) }
        let (_, details) = calculate(logs)
        #expect(details.lengths.map(\.count) == [2, 1, 1, 1, 1])
        #expect(details.medianSeconds == 1350)
        #expect(details.billableSeconds == 3600)
        #expect(details.billableKnownCount == 1)
    }
    @Test func yearMonthlyTotalsKeepReportedDates() {
        let logs = [WorkLog(id: "jan", timestamp: "2026-01-31T22:30:00Z", length: 7200), WorkLog(id: "feb", timestamp: "2026-02-02T10:00:00Z", length: 3600)]
        let (summary, details) = calculate(logs, period: .year)
        #expect(details.buckets[0].seconds == 7200)
        #expect(details.buckets[1].seconds == 3600)
        #expect(details.buckets.reduce(0) { $0 + $1.seconds } == summary.totalSeconds)
    }
}

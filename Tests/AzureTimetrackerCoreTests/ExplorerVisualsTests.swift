import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct ExplorerVisualsTests {
    var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!; return c }
    func date(_ value: String) -> Date { WireDate.parse(value)! }
    func visuals(_ logs: [WorkLog], period: StatisticsPeriod = .week, anchor: String = "2026-10-02T12:00:00Z", filter: ExplorerFilter = ExplorerFilter(), now: String = "2026-10-02T16:00:00Z") -> (ExplorerAnalysis, ExplorerVisuals) {
        let range = StatisticsRange(period: period, anchor: date(anchor), calendar: calendar)
        let analysis = ExplorerDataset(logs: logs).analyze(window: DateInterval(start: range.start, end: range.end), filter: filter, calendar: calendar, now: date(now))
        return (analysis, ExplorerVisuals(analysis: analysis, targets: WorkTargets(), calendar: calendar, now: date(now)))
    }
    @Test func dayHeatmapKeepsEmptyDaysAndMidnightClipping() {
        let log = WorkLog(id: "overnight", timestamp: "2026-10-01T21:30:00Z", length: 7200)
        let (analysis, charts) = visuals([log])
        #expect(charts.days.count == 7)
        #expect(charts.days.map(\.weekday) == [0, 1, 2, 3, 4, 5, 6])
        #expect(charts.days[3].seconds == 1800)
        #expect(charts.days[4].seconds == 5400)
        #expect(charts.days[5].future)
        #expect(charts.days.reduce(0) { $0 + $1.seconds } == analysis.total)
        #expect(charts.hours.reduce(0) { $0 + $1.seconds } == analysis.total)
        #expect(charts.progress.last?.seconds == analysis.total)
    }
    @Test func leapYearCalendarHasEveryDateAndCorrectColumns() {
        let (_, charts) = visuals([], period: .year, anchor: "2028-07-01T12:00:00Z")
        #expect(charts.days.count == 366)
        #expect(charts.weekCount == 53)
        #expect(charts.days[0].weekday == 5) // Saturday 1 January
        #expect(charts.days[59].date == date("2028-02-28T23:00:00Z"))
        #expect(charts.hours.isEmpty)
        #expect(charts.days.allSatisfy { $0.week >= 0 && $0.week < charts.weekCount })
    }
    @Test func filteredHeatmapAndProgressMatchTheSelectedTask() {
        let logs = [WorkLog(id: "a", timestamp: "2026-10-01T07:00:00Z", length: 3600, workItemId: 1), WorkLog(id: "b", timestamp: "2026-10-01T09:00:00Z", length: 7200, workItemId: 2)]
        var filter = ExplorerFilter(); filter.taskID = "ticket:1"
        let (analysis, charts) = visuals(logs, filter: filter)
        #expect(charts.days.reduce(0) { $0 + $1.seconds } == 3600)
        #expect(charts.hours.reduce(0) { $0 + $1.seconds } == analysis.total)
        #expect(charts.progress.last?.seconds == 3600)
        #expect(charts.days.reduce(0) { $0 + $1.entries } == 1)
    }
    @Test func daylightSavingHoursStaySeparateWithoutLosingTime() {
        for (anchor, count) in [("2026-10-25T12:00:00Z", 25), ("2026-03-29T12:00:00Z", 23)] {
            let range = StatisticsRange(period: .day, anchor: date(anchor), calendar: calendar)
            let log = WorkLog(id: "all-day", timestamp: WireDate.localString(range.start), length: range.end.timeIntervalSince(range.start))
            let (analysis, charts) = visuals([log], period: .day, anchor: anchor, now: "2026-12-31T12:00:00Z")
            #expect(charts.hours.count == count)
            #expect(charts.hours.map(\.slot) == Array(0..<count))
            #expect(Set(charts.hours.map(\.id)).count == count)
            #expect(charts.hours.reduce(0) { $0 + $1.seconds } == analysis.total)
        }
    }
    @Test func zoomedPartialDaysKeepHourPositionsAndExactDurations() {
        let window = DateInterval(start: date("2026-10-01T10:30:00Z"), end: date("2026-10-02T08:15:00Z"))
        let log = WorkLog(id: "span", timestamp: WireDate.localString(window.start), length: window.duration)
        let analysis = ExplorerDataset(logs: [log]).analyze(window: window, calendar: calendar)
        let charts = ExplorerVisuals(analysis: analysis, targets: WorkTargets(), calendar: calendar)
        #expect(charts.hours.first?.slot == 12)
        #expect(charts.hours.first?.seconds == 1800)
        #expect(charts.hours.last?.seconds == 900)
        #expect(charts.hours.filter { $0.day == charts.days[1].date }.first?.slot == 0)
        #expect(charts.hours.reduce(0) { $0 + $1.seconds } == analysis.total)
    }
    @Test func currentMonthlyBucketRetainsRecordedTimeBeforeMonthEnds() {
        let log = WorkLog(id: "october", timestamp: "2026-10-01T07:00:00Z", length: 3600)
        let (analysis, charts) = visuals([log], period: .year)
        #expect(charts.progress.last?.date == date("2026-10-02T16:00:00Z"))
        #expect(charts.progress.last?.seconds == analysis.total)
        #expect(charts.progress.last?.seconds == 3600)
        #expect(charts.targetProgress.last?.date == analysis.window.end)
        #expect(charts.targetProgress.last?.target == analysis.target)
    }
    @Test func emptyAndFutureWindowsDoNotProjectRecordedTime() {
        let (_, charts) = visuals([], period: .month, anchor: "2026-12-15T12:00:00Z")
        #expect(charts.progress.count == 1)
        #expect(charts.progress[0].seconds == 0)
        #expect(charts.days.allSatisfy { $0.future && $0.seconds == 0 })
        #expect(charts.targetProgress.last!.target > 0)
    }
    @Test func existingOverlapsRemainVisibleInHeatmapTotals() {
        let logs = [WorkLog(id: "a", timestamp: "2026-10-01T07:00:00Z", length: 3600), WorkLog(id: "b", timestamp: "2026-10-01T07:30:00Z", length: 3600)]
        let (analysis, charts) = visuals(logs, period: .day, anchor: "2026-10-01T12:00:00Z")
        #expect(analysis.overlap == 1800)
        #expect(charts.hours.first { $0.slot == 9 }?.seconds == 5400)
        #expect(charts.days[0].seconds == 7200)
        #expect(analysis.entries.count == 2)
    }
}

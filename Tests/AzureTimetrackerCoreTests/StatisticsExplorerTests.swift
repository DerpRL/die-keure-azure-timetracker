import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct StatisticsExplorerTests {
    var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!; return c }
    func date(_ value: String) -> Date { WireDate.parse(value)! }
    func window(_ from: String = "2026-10-02T07:00:00Z", _ to: String = "2026-10-02T11:00:00Z") -> DateInterval { DateInterval(start: date(from), end: date(to)) }
    func analyze(_ logs: [WorkLog], in bounds: DateInterval? = nil, filter: ExplorerFilter = ExplorerFilter(), titles: [Int: String] = [:]) -> ExplorerAnalysis {
        ExplorerDataset(logs: logs).analyze(window: bounds ?? window(), filter: filter, titles: titles, calendar: calendar, now: date("2026-12-31T20:00:00Z"))
    }
    @Test func zoomClampsBothDirectionsAndPreservesDuration() {
        let bounds = window()
        let early = StatisticsZoom.bounded(DateInterval(start: bounds.start.addingTimeInterval(-3600), duration: 7200), within: bounds)
        #expect(early.start == bounds.start); #expect(early.duration == 7200)
        let late = StatisticsZoom.bounded(DateInterval(start: bounds.end, duration: 7200), within: bounds)
        #expect(late.end == bounds.end); #expect(late.duration == 7200)
    }
    @Test func zoomMinimumMaximumAndPan() {
        let bounds = window()
        let small = StatisticsZoom.scaled(bounds, factor: 0.001, within: bounds)
        #expect(small.duration == 900)
        #expect(StatisticsZoom.scaled(small, factor: 1000, within: bounds) == bounds)
        #expect(StatisticsZoom.shifted(small, direction: 100, within: bounds).end == bounds.end)
        #expect(StatisticsZoom.shifted(small, direction: -100, within: bounds).start == bounds.start)
        #expect(StatisticsZoom.scaled(bounds, factor: .nan, within: bounds) == bounds)
    }
    @Test func zoomSmallerThanMinimumBoundsStillStaysInside() {
        let bounds = DateInterval(start: date("2026-10-02T07:00:00Z"), duration: 60)
        #expect(StatisticsZoom.scaled(bounds, factor: 0.1, within: bounds) == bounds)
    }
    @Test func clippingHasConsistentTotalsEverywhere() {
        let logs = [WorkLog(id: "a", timestamp: "2026-10-02T06:30:00Z", length: 7200, workItemId: 33984, billableLength: 3600),
                    WorkLog(id: "b", timestamp: "2026-10-02T10:30:00Z", length: 7200, workItemId: 33630)]
        let data = analyze(logs)
        #expect(data.total == 7200); #expect(data.count == 2); #expect(data.billable == 2700)
        #expect(data.billableKnownCount == 1)
        #expect(data.buckets.reduce(0) { $0 + $1.seconds } == data.total)
        #expect(data.tasks.reduce(0) { $0 + $1.seconds } == data.total)
        #expect(data.activities.reduce(0) { $0 + $1.seconds } == data.total)
        #expect(data.hours.reduce(0) { $0 + $1.seconds } == data.total)
        #expect(data.entries.allSatisfy { $0.clipped })
    }
    @Test func overlapUsesUnionIncludingNestedAndAdjacentEntries() {
        let logs = [WorkLog(id: "a", timestamp: "2026-10-02T07:00:00Z", length: 7200),
                    WorkLog(id: "b", timestamp: "2026-10-02T07:30:00Z", length: 1800),
                    WorkLog(id: "c", timestamp: "2026-10-02T08:30:00Z", length: 7200),
                    WorkLog(id: "d", timestamp: "2026-10-02T10:30:00Z", length: 1800)]
        let data = analyze(logs)
        #expect(data.total == 18000); #expect(data.covered == 14400); #expect(data.overlap == 3600)
    }
    @Test func halfOpenBoundariesAndInvalidDuplicates() {
        let valid = WorkLog(id: "one", timestamp: "2026-10-02T07:00:00Z", length: 3600)
        let dataset = ExplorerDataset(logs: [valid, valid, WorkLog(id: "end", timestamp: "2026-10-02T11:00:00Z", length: 3600),
            WorkLog(id: "before", timestamp: "2026-10-02T06:00:00Z", length: 3600), WorkLog(id: "bad-date", timestamp: "bad", length: 1),
            WorkLog(id: "bad-length", timestamp: valid.timestamp, length: .infinity), WorkLog(id: "negative", timestamp: valid.timestamp, length: -1),
            WorkLog(id: "too-long", timestamp: valid.timestamp, length: Double(Int32.max) + 1), WorkLog(id: "zero", timestamp: valid.timestamp, length: 0)])
        #expect(dataset.omitted == 4)
        let data = dataset.analyze(window: window(), calendar: calendar)
        #expect(data.count == 1); #expect(data.total == 3600)
    }
    @Test func midnightSegmentsDoNotDoubleCountEntryOrBillable() {
        let log = WorkLog(id: "night", timestamp: "2026-10-01T21:30:00Z", length: 7200, workItemId: 33984, billableLength: 3600)
        let data = analyze([log], in: window("2026-10-01T20:00:00Z", "2026-10-02T02:00:00Z"))
        #expect(data.entries.count == 2); #expect(data.count == 1); #expect(data.trackedDays == 2)
        #expect(data.billable == 3600); #expect(data.tasks[0].days == 2); #expect(data.tasks[0].count == 1)
        #expect(data.median == 7200)
    }
    @Test func weekdayFilterClipsOvernightPortion() {
        var filter = ExplorerFilter(); filter.weekday = 6 // Friday
        let data = analyze([WorkLog(id: "night", timestamp: "2026-10-01T21:30:00Z", length: 7200)], in: window("2026-10-01T20:00:00Z", "2026-10-02T02:00:00Z"), filter: filter)
        #expect(data.total == 5400); #expect(data.entries.count == 1); #expect(data.trackedDays == 1)
    }
    @Test func searchTitleTicketCommentAndCombinedActivityFilter() {
        let dev = ActivityType(id: "dev", name: "Development", color: nil)
        let logs = [WorkLog(id: "a", timestamp: "2026-10-02T07:00:00Z", length: 3600, workItemId: 33984, comment: "Café export", activityType: dev),
                    WorkLog(id: "b", timestamp: "2026-10-02T08:00:00Z", length: 3600, workItemId: 33630)]
        var filter = ExplorerFilter(); filter.query = "cafe"
        #expect(analyze(logs, filter: filter).count == 1)
        filter.query = "33984"; #expect(analyze(logs, filter: filter).count == 1)
        filter.query = "EXPORT RELIABILITY"; #expect(analyze(logs, filter: filter, titles: [33984: "Export reliability"]).count == 1)
        filter.activityID = "unspecified"; #expect(analyze(logs, filter: filter, titles: [33984: "Export reliability"]).count == 0)
    }
    @Test func taskFilterAndTicketFreeGrouping() {
        let logs = [WorkLog(id: "a", timestamp: "2026-10-02T07:00:00Z", length: 900, comment: "Daily standup"),
                    WorkLog(id: "b", timestamp: "2026-10-02T08:00:00Z", length: 900, comment: "Daily standup"),
                    WorkLog(id: "c", timestamp: "2026-10-02T09:00:00Z", length: 900, comment: "Planning")]
        let data = analyze(logs)
        #expect(data.tasks.count == 2); #expect(data.tasks[0].count == 2)
        var filter = ExplorerFilter(); filter.taskID = data.tasks[0].id
        #expect(analyze(logs, filter: filter).total == 1800)
    }
    @Test func originalLengthBandPersistsWhenZooming() {
        let logs = [WorkLog(id: "a", timestamp: "2026-10-02T07:00:00Z", length: 7200)]
        var filter = ExplorerFilter(); filter.lengthBand = 4
        let data = analyze(logs, in: window("2026-10-02T07:30:00Z", "2026-10-02T07:45:00Z"), filter: filter)
        #expect(data.total == 900); #expect(data.lengths[4].count == 1); #expect(data.lengths[1].count == 0)
        #expect([899.0, 900, 1800, 3600, 7200].map(ExplorerRecord.band) == [0, 1, 2, 3, 4])
    }
    @Test func adaptiveResolutionAndEmptyData() {
        #expect(ExplorerResolution.forDuration(365 * 86400) == .month)
        #expect(ExplorerResolution.forDuration(31 * 86400) == .day)
        #expect(ExplorerResolution.forDuration(86400) == .hour)
        #expect(ExplorerResolution.forDuration(3 * 3600) == .quarter)
        let data = analyze([], in: window("2026-10-02T07:00:00Z", "2026-10-02T07:15:00Z"))
        #expect(data.resolution == .minute); #expect(data.buckets.count == 3)
        #expect(data.total == 0); #expect(data.median == 0); #expect(data.overlap == 0)
    }
    @Test func hourlyBucketsHandleBothDSTTransitions() {
        for (anchor, count) in [("2026-10-25T12:00:00Z", 25), ("2026-03-29T12:00:00Z", 23)] {
            let range = StatisticsRange(period: .day, anchor: date(anchor), calendar: calendar)
            let log = WorkLog(id: "day", timestamp: WireDate.localString(range.start), length: range.end.timeIntervalSince(range.start))
            let data = analyze([log], in: DateInterval(start: range.start, end: range.end))
            #expect(data.buckets.count == count)
            #expect(data.buckets.reduce(0) { $0 + $1.seconds } == Double(count) * 3600)
            #expect(data.hours.reduce(0) { $0 + $1.seconds } == data.total)
        }
    }
    @Test func leapYearHasTwelveBucketsAndAccurateSchedule() {
        let range = StatisticsRange(period: .year, anchor: date("2028-07-01T12:00:00Z"), calendar: calendar)
        let data = analyze([], in: DateInterval(start: range.start, end: range.end))
        #expect(data.buckets.count == 12)
        #expect(data.buckets[1].interval.duration == 29 * 86400)
        let original = ActivityStatistics.calculate(logs: [], range: range, calendar: calendar)
        #expect(data.target == original.targetSeconds)
    }
    @Test func contextSwitchesRespectZoomAndExcludedOverlap() {
        let logs = [WorkLog(id: "a", timestamp: "2026-10-02T07:00:00Z", length: 3600, workItemId: 1),
                    WorkLog(id: "b", timestamp: "2026-10-02T08:00:00Z", length: 3600, workItemId: 2),
                    WorkLog(id: "c", timestamp: "2026-10-02T09:00:00Z", length: 3600, workItemId: 3)]
        #expect(analyze(logs).context.switches == 2)
        #expect(analyze(logs, in: window("2026-10-02T08:30:00Z", "2026-10-02T09:30:00Z")).context.switches == 1)
        let overlap = WorkLog(id: "d", timestamp: "2026-10-02T07:30:00Z", length: 7200, workItemId: 4)
        #expect(analyze(logs + [overlap]).context.switches == 0)
    }
    @Test func crossYearWeekKeepsContextFromBothYears() {
        let logs = [WorkLog(id: "a", timestamp: "2025-12-31T09:00:00Z", length: 3600, workItemId: 1), WorkLog(id: "b", timestamp: "2025-12-31T10:00:00Z", length: 3600, workItemId: 2),
                    WorkLog(id: "c", timestamp: "2026-01-01T09:00:00Z", length: 3600, workItemId: 1), WorkLog(id: "d", timestamp: "2026-01-01T10:00:00Z", length: 3600, workItemId: 2)]
        let data = analyze(logs, in: window("2025-12-29T00:00:00Z", "2026-01-04T23:00:00Z"))
        #expect(data.context.switches == 2)
    }
}

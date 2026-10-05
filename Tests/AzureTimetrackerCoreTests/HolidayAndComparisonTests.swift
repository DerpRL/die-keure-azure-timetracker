import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct HolidayTargetsTests {
    var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!; return c }
    func date(_ text: String) -> Date { WireDate.parse(text + "T12:00:00+02:00")! }
    @Test func belgianDates2026And2027() {
        let dates = BelgianHoliday.all(in: 2026, calendar: calendar).map { TargetException.key($0.date, calendar: calendar) }
        #expect(dates == ["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-07-21", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25"])
        let next = BelgianHoliday.all(in: 2027, calendar: calendar).map { TargetException.key($0.date, calendar: calendar) }
        #expect(next.contains("2027-03-29") && next.contains("2027-05-06") && next.contains("2027-05-17") && next.count == 10)
    }
    @Test func holidaysReduceWeekAndDoNotInventReplacementDates() {
        let targets = WorkTargets(), week = TargetProgress.weekInterval(at: date("2026-07-21"), calendar: calendar)
        #expect(targets.dailySeconds(on: date("2026-07-21"), calendar: calendar) == 0)
        #expect(targets.seconds(in: week, calendar: calendar) == 4 * 7.6 * 3600)
        #expect(targets.dailySeconds(on: date("2026-08-17"), calendar: calendar) == 7.6 * 3600)
    }
    @Test func halfDayCustomAndReplacementPriority() {
        var targets = WorkTargets(); targets.setHours(8, weekday: 2); targets.setHours(6, weekday: 6)
        targets.exceptions = [.init(date: date("2026-09-28"), kind: .halfDay, calendar: calendar), .init(date: date("2026-10-02"), kind: .halfDay, calendar: calendar), .init(date: date("2026-07-21"), kind: .custom, hours: 2, calendar: calendar), .init(date: date("2026-08-17"), kind: .replacement, calendar: calendar)]
        #expect(targets.dailySeconds(on: date("2026-09-28"), calendar: calendar) == 4 * 3600)
        #expect(targets.dailySeconds(on: date("2026-10-02"), calendar: calendar) == 3 * 3600)
        #expect(targets.dailySeconds(on: date("2026-07-21"), calendar: calendar) == 2 * 3600)
        #expect(targets.dailySeconds(on: date("2026-08-17"), calendar: calendar) == 0)
    }
    @Test func oldConfigurationDecodesAndExceptionsRoundTrip() throws {
        var targets = try JSONDecoder().decode(WorkTargets.self, from: Data(#"{"weeklyHours":38,"dailyHours":7.6}"#.utf8))
        #expect(targets.isValid && targets.usesBelgianHolidays && targets.exceptions.isEmpty)
        targets.exceptions = [.init(date: date("2026-12-24"), kind: .leave, note: "Leave", calendar: calendar)]
        #expect(try JSONDecoder().decode(WorkTargets.self, from: JSONEncoder().encode(targets)) == targets)
        targets.usesBelgianHolidays = false
        #expect(targets.dailySeconds(on: date("2026-07-21"), calendar: calendar) == 27360)
    }
    @Test func invalidHoursDatesAndDuplicatesRejected() {
        var targets = WorkTargets(), item = TargetException(date: date("2026-10-02"), kind: .custom, hours: 25, calendar: calendar)
        targets.exceptions = [item]; #expect(!targets.isValid)
        item.hours = 2; item.id = "2026-02-30"; targets.exceptions = [item]; #expect(!targets.isValid)
        item.id = "2026-10-02"; targets.exceptions = [item, item]; #expect(!targets.isValid)
    }
    @Test func dstCivilDatesAndPartialDayTotals() {
        var targets = WorkTargets(); targets.setHours(8, weekday: 1)
        let day = calendar.dateInterval(of: .day, for: date("2026-03-29"))!
        #expect(day.duration == 23 * 3600)
        #expect(targets.seconds(in: day, calendar: calendar) == 8 * 3600)
        #expect(targets.seconds(in: DateInterval(start: day.start, duration: day.duration / 2), calendar: calendar) == 4 * 3600)
        #expect(TargetException.key(day.end, calendar: calendar) == "2026-03-30")
    }
}

@Suite struct PeriodComparisonTests {
    var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Brussels")!; return c }
    func date(_ text: String) -> Date { WireDate.parse(text)! }
    @Test func partialWeekMatchesLocalDaysAcrossDst() {
        let current = StatisticsRange(period: .week, anchor: date("2026-03-25T12:00:00+01:00"), calendar: calendar)
        let previous = current.shifted(-1, calendar: calendar)
        let now = date("2026-03-25T12:00:00+01:00")
        let (a, b) = PeriodComparison.windows(current: current, previous: previous, matchElapsed: true, now: now, calendar: calendar)
        #expect(a.end == now && b.end == date("2026-03-18T12:00:00+01:00"))
        let whole = PeriodComparison.windows(current: current, previous: previous, matchElapsed: false, now: now, calendar: calendar)
        #expect(whole.0.end == current.end && whole.1.end == previous.end)
    }
    @Test func finishedPeriodsStayWholeAndShortMonthsClamp() {
        let march = StatisticsRange(period: .month, anchor: date("2026-03-30T12:00:00+02:00"), calendar: calendar)
        let feb = march.shifted(-1, calendar: calendar)
        let result = PeriodComparison.windows(current: march, previous: feb, matchElapsed: true, now: date("2026-03-30T12:00:00+02:00"), calendar: calendar)
        #expect(result.1.end == feb.end)
        let complete = PeriodComparison.windows(current: march, previous: feb, matchElapsed: true, now: date("2026-05-01T12:00:00+02:00"), calendar: calendar)
        #expect(complete.0.end == march.end)
    }
    @Test func zeroBaselineAndNegativeChangesAreHonest() {
        #expect(ComparisonDelta(id: "a", title: "A", current: 3600, previous: 0).percentage == nil)
        #expect(ComparisonDelta(id: "a", title: "A", current: 1800, previous: 3600).percentage == -50)
        #expect(ComparisonDelta(id: "a", title: "A", current: 0, previous: 3600).percentage == -100)
    }
    @Test func sharedFiltersIncludeTasksOnlyPresentOnOneSide() {
        let first = editableLog(start: "2026-09-28T09:00:00", length: 3600)
        var second = editableLog("22222222-2222-2222-2222-222222222222", start: "2026-09-21T09:00:00", length: 7200); second.workItemId = 456
        let dataset = ExplorerDataset(logs: [first, second]), a = StatisticsRange(period: .week, anchor: first.date!), b = a.shifted(-1)
        var filter = ExplorerFilter(); filter.taskID = "ticket:456"
        let result = PeriodComparison(current: dataset.analyze(window: DateInterval(start: a.start, end: a.end), filter: filter, resolution: .day), previous: dataset.analyze(window: DateInterval(start: b.start, end: b.end), filter: filter, resolution: .day))
        #expect(result.current.total == 0 && result.previous.total == 7200)
        #expect(result.tasks.count == 1 && result.tasks.first?.difference == -7200 && result.buckets.count == 7)
    }
    @Test func unequalMonthBucketsKeepAbsentDaysDistinctFromZero() {
        let dataset = ExplorerDataset(logs: []), a = StatisticsRange(period: .month, anchor: date("2026-03-01T12:00:00Z"), calendar: calendar), b = a.shifted(-1, calendar: calendar)
        let result = PeriodComparison(current: dataset.analyze(window: DateInterval(start: a.start, end: a.end), calendar: calendar, resolution: .day), previous: dataset.analyze(window: DateInterval(start: b.start, end: b.end), calendar: calendar, resolution: .day))
        #expect(result.buckets.count == 31 && result.buckets[28].previous == nil && result.buckets[27].previous?.seconds == 0)
    }
}

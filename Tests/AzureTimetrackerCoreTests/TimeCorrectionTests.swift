import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct TimeCorrectionTests {
    let start = localDate("2026-09-28T09:00:00")
    func entry(_ id: String, _ offset: Double, _ duration: Double) -> WorkLog {
        var log = editableLog(id, start: WireDate.localString(start.addingTimeInterval(offset)), length: duration)
        log.isCanDelete = true; return log
    }
    @Test func unionFindsGapsWithoutFalseGapsInsideNestedEntries() throws {
        let logs = [entry("a", 0, 3600), entry("b", 600, 600), entry("c", 4800, 1200)]
        let issues = try TimeCorrections.issues(logs: logs + [logs[0]], window: .init(start: start, duration: 6000), minimumGap: 300)
        let gaps = issues.filter { $0.kind == .gap }, overlaps = issues.filter { $0.kind == .overlap }
        #expect(gaps.count == 1 && gaps[0].seconds == 1200 && gaps[0].earlier?.id == "a")
        #expect(overlaps.count == 1 && overlaps[0].seconds == 600)
    }
    @Test func touchingEntriesDoNotOverlapAndOvernightIsClipped() throws {
        let logs = [entry("a", -3600, 7200), entry("b", 3600, 3600)]
        let issues = try TimeCorrections.issues(logs: logs, window: .init(start: start, duration: 7200), minimumGap: 300)
        #expect(issues.isEmpty)
    }
    @Test func leadingTrailingAndThresholdGaps() throws {
        let logs = [entry("a", 600, 600)]
        let issues = try TimeCorrections.issues(logs: logs, window: .init(start: start, duration: 1800), minimumGap: 600)
        #expect(issues.count == 2 && issues[0].earlier == nil && issues[1].later == nil)
        let plan = try TimeCorrections.fillGap(issues[0], usingEarlier: false)
        #expect(plan.desired[0].start == start && plan.desired[0].seconds == 1200)
        #expect(throws: (any Error).self) { try TimeCorrections.fillGap(issues[0], usingEarlier: true) }
    }
    @Test func invalidIntervalsDoNotInventGaps() {
        var log = entry("a", 0, 3600); log.timestamp = "bad date"
        #expect(throws: (any Error).self) { try TimeCorrections.issues(logs: [log], window: .init(start: start, duration: 7200), minimumGap: 300) }
    }
    @Test func removeMiddlePreservesBothWorkSegmentsAndBillableProportion() throws {
        var log = entry("11111111-1111-1111-1111-111111111111", 0, 10800); log.billableLength = 5400
        let plan = try TimeCorrections.removeInterval(log, start: start.addingTimeInterval(3600), end: start.addingTimeInterval(7200))
        #expect(plan.desired.map(\.seconds) == [3600, 3600])
        #expect(plan.desired.map(\.billableSeconds) == [1800, 1800])
        #expect(plan.desired[0].existingID == log.id && plan.desired[1].existingID == nil)
        #expect(plan.desired[1].start == start.addingTimeInterval(7200))
    }
    @Test func separateIntervalPreservesTotalsAndChangesOnlyIdleMetadata() throws {
        var log = entry("a", 0, 10800); log.billableLength = 1001
        let separate = try WorkLogDraft(start: start.addingTimeInterval(3600), end: start.addingTimeInterval(7200), ticketID: nil, comment: "Break", activityID: "break")
        let plan = try TimeCorrections.removeInterval(log, start: separate.start, end: separate.edit.end, separate: separate)
        #expect(plan.desired.reduce(0) { $0 + $1.seconds } == 10800)
        #expect(plan.desired.reduce(0) { $0 + $1.billableSeconds } == 1001)
        #expect(plan.desired[1].comment == "Break" && plan.desired[1].ticketID == nil)
        #expect(plan.desired[0].ticketID == log.workItemId && plan.desired[2].ticketID == log.workItemId)
    }
    @Test func boundaryRemovesOnlyOverlappingDuration() throws {
        let a = entry("a", 0, 7200), b = entry("b", 5400, 5400)
        let issue = try #require(TimeCorrections.issues(logs: [a, b], window: .init(start: start, duration: 10800), minimumGap: 1).first)
        let plan = try TimeCorrections.moveBoundary(issue, to: start.addingTimeInterval(6300))
        #expect(plan.desired.map(\.seconds) == [6300, 4500])
        #expect(plan.desired[0].edit.end == plan.desired[1].start)
        #expect(throws: (any Error).self) { try TimeCorrections.moveBoundary(issue, to: start.addingTimeInterval(1)) }
    }
    @Test func wholeRemovalAndOutOfBoundsCannotDeleteEntries() {
        let log = entry("a", 0, 3600)
        #expect(throws: (any Error).self) { try TimeCorrections.removeInterval(log, start: start, end: start.addingTimeInterval(3600)) }
        #expect(throws: (any Error).self) { try TimeCorrections.removeInterval(log, start: start.addingTimeInterval(7200), end: start.addingTimeInterval(8000)) }
    }
    @Test func correctionUndoRestoresOriginalAndChangedSourceBlocksSave() async throws {
        let log = entry("11111111-1111-1111-1111-111111111111", 0, 10800), api = try MutationFixture([log]), capture = ChangeCapture()
        let plan = try TimeCorrections.removeInterval(log, start: start.addingTimeInterval(3600), end: start.addingTimeInterval(7200))
        let saved = try await WorkLogOperations.apply(plan, workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) })
        #expect(saved.after.count == 2)
        let restored = try await WorkLogOperations.apply(.undo(saved), workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) })
        #expect(restored.after.count == 1 && restored.after[0].length == log.length)
        #expect(throws: (any Error).self) { try TimeCorrections.removeInterval(log, start: start, end: start) }
        await #expect(throws: (any Error).self) { try await WorkLogOperations.apply(plan, workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) }) }
    }
    @Test func fractionalIdleBoundariesRoundTripThroughSecondPrecisionAPI() async throws {
        let log = entry("11111111-1111-1111-1111-111111111111", 0, 10800), api = try MutationFixture([log]), capture = ChangeCapture()
        let plan = try TimeCorrections.removeInterval(log, start: start.addingTimeInterval(3600.8), end: start.addingTimeInterval(7200.6))
        #expect(plan.desired.map(\.seconds) == [3601, 3599])
        for draft in plan.desired { #expect(draft.start == WireDate.parse(WireDate.localString(draft.start), localIfUnspecified: true)) }
        let saved = try await WorkLogOperations.apply(plan, workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) })
        #expect(saved.status == .complete && saved.after.reduce(0) { $0 + $1.length } == 7200)
    }
    @Test func runningEntryCannotBeCorrected() async throws {
        let log = entry("11111111-1111-1111-1111-111111111111", 0, 10800)
        let tracking = try JSONDecoder().decode(TrackingState.self, from: Data("{\"track\":{\"trackingState\":\"tracking\",\"workLogId\":\"\(log.id)\"}}".utf8))
        let api = try MutationFixture([log], tracking: tracking), capture = ChangeCapture()
        let plan = try TimeCorrections.removeInterval(log, start: start.addingTimeInterval(3600), end: start.addingTimeInterval(7200))
        await #expect(throws: (any Error).self) { try await WorkLogOperations.apply(plan, workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) }) }
        #expect(await api.mutations.isEmpty)
    }
}

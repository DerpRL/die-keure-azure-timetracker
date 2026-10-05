import Foundation
import Testing
@testable import AzureTimetrackerCore

func editableLog(_ id: String = "11111111-1111-1111-1111-111111111111", start: String = "2026-09-28T09:00:00", length: Double = 3600) -> WorkLog {
    var log = WorkLog(id: id, timestamp: start, length: length, workItemId: 123, comment: "Development", activityType: nil)
    log.isCanEdit = true; log.editedTimestamp = "2026-09-28T12:00:00"; return log
}
func localDate(_ raw: String) -> Date { WireDate.parse(raw, localIfUnspecified: true)! }

actor EditingFixture: WorkLogEditingService {
    var entry: WorkLog
    var entries: [WorkLog]
    var tracking: TrackingState
    var writes = 0
    var failWrite = false
    var failHistory = false
    var cancelHistory = false
    var wrongResponse = false
    var changeDuringHistory = false
    init(entry: WorkLog = editableLog(), entries: [WorkLog] = [], tracking: TrackingState) {
        self.entry = entry; self.entries = entries; self.tracking = tracking
    }
    func current() -> TrackingState { tracking }
    func workLog(id: String) -> WorkLog { entry }
    func workLogs(before end: Date) throws -> [WorkLog] {
        if cancelHistory { throw CancellationError() }
        if failHistory { throw AppError.message("Fixture history unavailable") }
        if changeDuringHistory { entry.length += 1 }
        return entries
    }
    func setEntries(_ logs: [WorkLog]) { entries = logs }
    func setEntry(_ log: WorkLog) { entry = log }
    func setChangeDuringHistory() { changeDuringHistory = true }
    func setFailure() { failWrite = true }
    func setHistoryFailure() { failHistory = true }
    func setHistoryCancellation() { cancelHistory = true }
    func setWrongResponse() { wrongResponse = true }
    func updateWorkLogTime(id: String, edit: WorkLogTimeEdit) throws -> WorkLog {
        writes += 1
        if failWrite { throw AppError.message("Fixture timeout after write") }
        if !wrongResponse { entry.timestamp = WireDate.localString(edit.start); entry.length = Double(edit.seconds) }
        return entry
    }
}

@Suite struct TimeEditingTests {
    var edit: WorkLogTimeEdit { WorkLogTimeEdit(start: localDate("2026-09-28T09:00:00"), end: localDate("2026-09-28T11:00:00")) }
    @Test func overlapsIncludeContainingAndCrossMidnightEntriesButNotTouchingEdges() throws {
        let logs = [editableLog("before", start: "2026-09-28T08:00:00"), editableLog("after", start: "2026-09-28T11:00:00"),
                    editableLog("inside", start: "2026-09-28T09:30:00", length: 1800), editableLog("contains", start: "2026-09-27T23:00:00", length: 13 * 3600),
                    editableLog(), editableLog("inside", start: "2026-09-28T09:30:00", length: 1800)]
        let conflicts = try WorkLogOverlap.conflicts(edit: edit, excluding: editableLog().id, logs: logs, state: state())
        #expect(Set(conflicts.map(\.id)) == ["inside", "contains"])
        #expect(conflicts.first { $0.id == "contains" }?.overlap == 7200)
    }
    @Test func liveTimerIsCountedOnceAndCannotBeEdited() throws {
        var tracking = try state(456)
        tracking.track?.currentTrackStartedDateTime = "2026-09-28T10:00:00"
        let now = localDate("2026-09-28T12:00:00")
        let conflicts = try WorkLogOverlap.conflicts(edit: edit, excluding: editableLog().id, logs: [editableLog("session", start: "2026-09-28T10:00:00")], state: tracking, now: now)
        #expect(conflicts.count == 1 && conflicts[0].active && conflicts[0].overlap == 3600)
        #expect(throws: (any Error).self) { try WorkLogOverlap.conflicts(edit: edit, excluding: "session", logs: [], state: tracking, now: now) }
        tracking.track?.workLogId = nil
        #expect(throws: (any Error).self) { try WorkLogOverlap.conflicts(edit: edit, excluding: editableLog().id, logs: [], state: tracking) }
    }
    @Test func incompleteDatesAreReportedAndInvalidDraftsAreRejected() throws {
        #expect(throws: (any Error).self) { try WorkLogOverlap.conflicts(edit: edit, excluding: editableLog().id, logs: [editableLog("bad", start: "invalid")], state: state()) }
        for edit in [WorkLogTimeEdit(start: Date(), end: .distantFuture), WorkLogTimeEdit(start: Date(), end: .distantPast), WorkLogTimeEdit(start: Date(), end: Date().addingTimeInterval(-1))] {
            #expect(throws: (any Error).self) { try edit.validate() }
        }
    }
    @Test func lockedAndExternallyChangedEntriesPreventWrites() async throws {
        let original = editableLog(), fixture = try EditingFixture(tracking: state())
        var changed = original; changed.isCanEdit = false; await fixture.setEntry(changed)
        await #expect(throws: (any Error).self) { try await WorkLogEditing.review(original: original, edit: edit, service: fixture) }
        changed = original; changed.length += 1; await fixture.setEntry(changed)
        await #expect(throws: (any Error).self) { try await WorkLogEditing.review(original: original, edit: edit, service: fixture) }
        changed = original; changed.editedTimestamp = "new"; await fixture.setEntry(changed)
        await #expect(throws: (any Error).self) { try await WorkLogEditing.review(original: original, edit: edit, service: fixture) }
        #expect(await fixture.writes == 0)
    }
    @Test func overlappingEditSavesDirectlyWithoutPriorReview() async throws {
        let fixture = try EditingFixture(entries: [editableLog("other", start: "2026-09-28T10:30:00")], tracking: state())
        let result = try await WorkLogEditing.save(original: editableLog(), edit: edit, service: fixture)
        #expect(result.saved.length == 7200 && result.saved.workItemId == 123 && result.saved.comment == "Development")
        #expect(result.conflicts.count == 1 && result.conflicts[0].overlap == 1800)
        #expect(result.overlapIssue == nil)
        #expect(await fixture.writes == 1)
    }
    @Test func newOverlapAfterOptionalCheckIsReturnedAsNoticeAndDoesNotBlockSave() async throws {
        let fixture = try EditingFixture(tracking: state())
        let original = editableLog()
        let checked = try await WorkLogEditing.review(original: original, edit: edit, service: fixture)
        #expect(checked.conflicts.isEmpty)
        await fixture.setEntries([editableLog("other", start: "2026-09-28T10:30:00")])
        let result = try await WorkLogEditing.save(original: original, edit: edit, service: fixture)
        #expect(result.saved.length == 7200)
        #expect(result.conflicts.count == 1)
        #expect(await fixture.writes == 1)
    }
    @Test func unavailableOverlapHistoryWarnsButDoesNotBlockValidSave() async throws {
        let fixture = try EditingFixture(tracking: state())
        await fixture.setHistoryFailure()
        let result = try await WorkLogEditing.save(original: editableLog(), edit: edit, service: fixture)
        #expect(result.saved.length == 7200)
        #expect(result.overlapIssue?.contains("history unavailable") == true)
        #expect(await fixture.writes == 1)
    }
    @Test func unreadableOtherEntryOrOtherTimerStartDoesNotBlockSave() async throws {
        let badHistory = try EditingFixture(entries: [editableLog("bad", start: "invalid")], tracking: state())
        var otherTimer = try state(456); otherTimer.track?.currentTrackStartedDateTime = nil
        let missingTimerStart = EditingFixture(tracking: otherTimer)
        for fixture in [badHistory, missingTimerStart] {
            let result = try await WorkLogEditing.save(original: editableLog(), edit: edit, service: fixture)
            #expect(result.saved.length == 7200 && result.overlapIssue != nil)
            #expect(await fixture.writes == 1)
        }
    }
    @Test func selectedRunningEntryAndUnknownRunningEntryStillPreventSaveEvenWithoutHistory() async throws {
        var ownTimer = try state(123); ownTimer.track?.workLogId = editableLog().id
        var unknownTimer = try state(456); unknownTimer.track?.workLogId = nil
        for tracking in [ownTimer, unknownTimer] {
            let fixture = EditingFixture(tracking: tracking)
            await fixture.setHistoryFailure()
            await #expect(throws: (any Error).self) { try await WorkLogEditing.save(original: editableLog(), edit: edit, service: fixture) }
            #expect(await fixture.writes == 0)
        }
    }
    @Test func cancelledOverlapRequestDoesNotContinueToWrite() async throws {
        let fixture = try EditingFixture(tracking: state())
        await fixture.setHistoryCancellation()
        await #expect(throws: CancellationError.self) { try await WorkLogEditing.save(original: editableLog(), edit: edit, service: fixture) }
        #expect(await fixture.writes == 0)
    }
    @Test func changeDuringHistoryFetchIsCaughtBeforeSaving() async throws {
        let fixture = try EditingFixture(tracking: state())
        let approved = try await WorkLogEditing.review(original: editableLog(), edit: edit, service: fixture)
        await fixture.setChangeDuringHistory()
        await #expect(throws: (any Error).self) { try await WorkLogEditing.save(original: approved.original, edit: approved.edit, service: fixture) }
        #expect(await fixture.writes == 0)
    }
    @Test func permissionRevocationAfterReviewPreventsSave() async throws {
        let fixture = try EditingFixture(tracking: state())
        let approved = try await WorkLogEditing.review(original: editableLog(), edit: edit, service: fixture)
        var locked = editableLog(); locked.isCanEdit = false; await fixture.setEntry(locked)
        await #expect(throws: (any Error).self) { try await WorkLogEditing.save(original: approved.original, edit: approved.edit, service: fixture) }
        #expect(await fixture.writes == 0)
    }
    @Test func failedOrMismatchedWriteIsNeverRetried() async throws {
        for wrong in [false, true] {
            let fixture = try EditingFixture(tracking: state())
            let approved = try await WorkLogEditing.review(original: editableLog(), edit: edit, service: fixture)
            if wrong { await fixture.setWrongResponse() } else { await fixture.setFailure() }
            await #expect(throws: (any Error).self) { try await WorkLogEditing.save(original: approved.original, edit: approved.edit, service: fixture) }
            #expect(await fixture.writes == 1)
        }
    }
}

@Suite struct TrackingAttentionTests {
    func stopped(_ reason: Int = 4, log: String = "first") throws -> TrackingState {
        try JSONDecoder().decode(TrackingState.self, from: JSONSerialization.data(withJSONObject: ["track": ["trackingState": "clientInputRequired", "stoppedTrackType": reason, "tfsId": 123, "workLogId": log, "activityTypeId": "dev", "remark": "Work", "trackStatusChangeDate": "2026-09-28T11:00:00"]]))
    }
    @Test func limitStopUsesServerReasonAndPreservesTaskSelection() throws {
        let prompt = try #require(TrackingAttention.from(stopped()))
        #expect(prompt.stopped && prompt.reason == .timeLimit && prompt.ticketID == 123 && prompt.activityID == "dev" && prompt.remark == "Work")
        var repeated = try stopped(); repeated.timestamp = 98765
        #expect(TrackingAttention.from(repeated)?.id == prompt.id)
        #expect(try TrackingAttention.from(stopped(log: "next"))?.id != prompt.id)
    }
    @Test func manualStopsOtherClientsAndElapsedTimeAloneDoNotTriggerPrompt() throws {
        for reason in [0,2,3,5,6,99] { #expect(try TrackingAttention.from(stopped(reason)) == nil) }
        var running = try state(123); running.track?.currentTrackLength = 8000
        #expect(TrackingAttention.from(running) == nil)
        #expect(try TrackingAttention.from(state()) == nil)
    }
    @Test func activityCheckAndTimeoutAreDistinctPrompts() throws {
        var checking = try state(123); checking.track?.trackingState = .number(3)
        #expect(TrackingAttention.from(checking)?.reason == .activityCheck)
        #expect(try TrackingAttention.from(stopped(1))?.reason == .activityTimeout)
    }
    @Test func staleStopPromptCannotResumeDifferentStoppedTask() async throws {
        let original = try stopped(), actual = try stopped(log: "another")
        let fixture = StubTracker(initial: actual, stopped: actual)
        await #expect(throws: (any Error).self) {
            try await TrackingTransaction.switchTo(123, expectedIdentity: "idle", activityType: "dev", remark: "Work", expectedAttention: TrackingAttention.from(original), service: fixture)
        }
        #expect(await fixture.calls == ["current"])
    }
    @Test func continuingConfirmedLimitStopStartsNewSessionWithoutStoppingAgain() async throws {
        let original = try stopped(), fixture = StubTracker(initial: original, stopped: original)
        let result = try await TrackingTransaction.switchTo(123, expectedIdentity: "idle", activityType: "dev", remark: "Work", expectedAttention: TrackingAttention.from(original), service: fixture)
        #expect(result.running)
        #expect(await fixture.calls == ["current", "start:123"])
    }
}

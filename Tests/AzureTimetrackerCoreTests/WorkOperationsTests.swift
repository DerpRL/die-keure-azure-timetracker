import Foundation
import Testing
@testable import AzureTimetrackerCore

actor MutationFixture: WorkLogMutationService {
    var entries: [String: WorkLog]
    var mutations: [String] = []
    var loseCreateResponse = false
    var failUpdate = false
    var tracking: TrackingState
    init(_ logs: [WorkLog], tracking: TrackingState? = nil) throws {
        entries = Dictionary(uniqueKeysWithValues: logs.map { ($0.id, $0) }); self.tracking = try tracking ?? state()
    }
    func current() -> TrackingState { tracking }
    func workLog(id: String) throws -> WorkLog { guard let log = entries[id] else { throw AppError.notFound }; return log }
    func findWorkLog(id: String) -> WorkLog? { entries[id] }
    func workLogs(before end: Date) -> [WorkLog] { Array(entries.values) }
    func updateWorkLogTime(id: String, edit: WorkLogTimeEdit) throws -> WorkLog { var d = try WorkLogDraft(workLog(id: id)); d.start = edit.start; d.seconds = edit.seconds; return try replaceWorkLogTime(id: id, draft: d) }
    func createWorkLog(_ draft: WorkLogDraft) throws -> WorkLog {
        mutations.append("create")
        var log = editableLog(UUID().uuidString, start: WireDate.localString(draft.start), length: Double(draft.seconds))
        log.billableLength = Double(draft.billableSeconds); log.workItemId = draft.ticketID; log.comment = draft.comment
        log.activityType = draft.activityID.map { ActivityType(id: $0) }; log.isCanDelete = true; entries[log.id] = log
        if loseCreateResponse { throw AppError.message("Response lost after create") }
        return log
    }
    func replaceWorkLogTime(id: String, draft: WorkLogDraft) throws -> WorkLog {
        mutations.append("update")
        if failUpdate { throw AppError.message("Update unavailable") }
        var log = try workLog(id: id); log.timestamp = WireDate.localString(draft.start); log.length = Double(draft.seconds)
        log.billableLength = Double(draft.billableSeconds); log.editedTimestamp = UUID().uuidString; entries[id] = log; return log
    }
    func deleteWorkLog(id: String) { mutations.append("delete"); entries[id] = nil }
    func replace(_ log: WorkLog) { entries[log.id] = log }
    func setLostCreate() { loseCreateResponse = true }
    func setFailedUpdate() { failUpdate = true }
}
actor ChangeCapture {
    var records: [WorkLogChange] = []
    var fail = false
    init(fail: Bool = false) { self.fail = fail }
    func checkpoint(_ value: WorkLogChange) throws { if fail { throw AppError.message("Disk unavailable") }; records.append(value) }
}

@Suite struct WorkOperationsTests {
    func pair() -> [WorkLog] {
        var first = editableLog(length: 3600), second = editableLog("22222222-2222-2222-2222-222222222222", start: "2026-09-28T10:00:00")
        first.isCanDelete = true; second.isCanDelete = true; first.billableLength = 1800; second.billableLength = 900
        return [first, second]
    }
    @Test func splitPreservesExactTimeAndBillableRemainder() throws {
        var log = pair()[0]; log.billableLength = 1001
        let plan = try WorkLogPlan.split(log, at: localDate("2026-09-28T09:20:00"), secondTicket: 456, secondComment: "Other task", secondActivity: nil)
        #expect(plan.desired.map(\.seconds) == [1200, 2400])
        #expect(plan.desired.map(\.billableSeconds).reduce(0, +) == 1001)
        #expect(plan.desired[0].edit.end == plan.desired[1].start && plan.desired[1].ticketID == 456)
        #expect(throws: (any Error).self) { try WorkLogPlan.split(log, at: log.date!, secondTicket: nil, secondComment: nil, secondActivity: nil) }
    }
    @Test func mergePreservesTotalsAndRejectsGapsOverlapsOrDifferentMetadata() throws {
        let logs = pair(), plan = try WorkLogPlan.merge(logs.reversed())
        #expect(plan.desired[0].seconds == 7200 && plan.desired[0].billableSeconds == 2700)
        for timestamp in ["2026-09-28T10:00:01", "2026-09-28T09:59:59"] {
            var changed = logs[1]; changed.timestamp = timestamp
            #expect(throws: (any Error).self) { try WorkLogPlan.merge([logs[0], changed]) }
        }
        var changed = logs[1]; changed.comment = "Different purpose"
        #expect(throws: (any Error).self) { try WorkLogPlan.merge([logs[0], changed]) }
    }
    @Test func splitAndUndoRestoreOriginalTimeWithoutDuplicateRequests() async throws {
        let log = pair()[0], api = try MutationFixture([log]), capture = ChangeCapture()
        let plan = try WorkLogPlan.split(log, at: localDate("2026-09-28T09:30:00"), secondTicket: 456, secondComment: "Another task", secondActivity: nil)
        let result = try await WorkLogOperations.apply(plan, workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) })
        #expect(result.status == .complete && result.after.count == 2)
        #expect(await api.mutations == ["create", "update"])
        let undone = try await WorkLogOperations.apply(.undo(result), workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) })
        #expect(undone.after.count == 1 && undone.after[0].length == log.length && undone.after[0].billableLength == log.billableLength)
        #expect(await api.mutations == ["create", "update", "update", "delete"])
    }
    @Test func mergeAndUndoRecreateRemovedEntryWithNewID() async throws {
        let logs = pair(), api = try MutationFixture(logs), capture = ChangeCapture()
        let result = try await WorkLogOperations.apply(.merge(logs), workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) })
        #expect(await api.mutations == ["update", "delete"])
        #expect(result.after.count == 1)
        let undo = try await WorkLogOperations.apply(.undo(result), workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) })
        #expect(undo.after.count == 2 && !undo.after.contains { $0.id == logs[1].id })
        #expect(undo.after.reduce(0) { $0 + $1.length } == 7200)
        #expect(undo.after.reduce(0) { $0 + ($1.billableLength ?? $1.length) } == 2700)
    }
    @Test func editCanBeUndoneButExternalChangesPreventUndo() async throws {
        let log = pair()[0], api = try MutationFixture([log]), capture = ChangeCapture()
        let result = try await WorkLogOperations.apply(.edit(log, time: WorkLogTimeEdit(start: log.date!, end: log.date!.addingTimeInterval(7200))), workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) })
        var changed = result.after[0]; changed.comment = "Edited elsewhere"; await api.replace(changed)
        await #expect(throws: (any Error).self) { try await WorkLogOperations.apply(.undo(result), workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) }) }
        #expect(await api.mutations == ["update"])
    }
    @Test func missingDeletePermissionAndRunningEntriesPreventEveryWrite() async throws {
        var logs = pair(); logs[1].isCanDelete = false
        let capture = ChangeCapture(), denied = try MutationFixture(logs)
        await #expect(throws: (any Error).self) { try await WorkLogOperations.apply(.merge(logs), workspace: "test", service: denied, checkpoint: { try await capture.checkpoint($0) }) }
        #expect(await denied.mutations.isEmpty)
        let active = try MutationFixture(pair(), tracking: state(123, session: logs[0].id))
        await #expect(throws: (any Error).self) { try await WorkLogOperations.apply(.merge(pair()), workspace: "test", service: active, checkpoint: { try await capture.checkpoint($0) }) }
        #expect(await active.mutations.isEmpty)
    }
    @Test func lostCreateIsNeverRetriedAndLeavesDurableReviewRecord() async throws {
        let log = pair()[0], api = try MutationFixture([log]), capture = ChangeCapture(); await api.setLostCreate()
        let plan = try WorkLogPlan.split(log, at: log.date!.addingTimeInterval(1800), secondTicket: 123, secondComment: "Development", secondActivity: nil)
        await #expect(throws: (any Error).self) { try await WorkLogOperations.apply(plan, workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) }) }
        #expect(await api.mutations == ["create"])
        #expect(await api.entries.count == 2)
        #expect(await capture.records.last?.status == .needsReview)
        #expect(await api.entries[log.id]?.length == log.length)
    }
    @Test func failedMergeDoesNotDeleteSourcesAndJournalFailurePreventsWrites() async throws {
        let api = try MutationFixture(pair()), capture = ChangeCapture(); await api.setFailedUpdate()
        await #expect(throws: (any Error).self) { try await WorkLogOperations.apply(.merge(pair()), workspace: "test", service: api, checkpoint: { try await capture.checkpoint($0) }) }
        #expect(await api.mutations == ["update"])
        #expect(await api.entries.count == 2)
        let other = try MutationFixture(pair()), unavailable = ChangeCapture(fail: true)
        await #expect(throws: (any Error).self) { try await WorkLogOperations.apply(.merge(pair()), workspace: "test", service: other, checkpoint: { try await unavailable.checkpoint($0) }) }
        #expect(await other.mutations.isEmpty)
    }
    @Test func journalRoundTripsAllRecoveryData() throws {
        let plan = try WorkLogPlan.merge(pair()), record = WorkLogChange(plan: plan, workspace: "scope")
        let decoded = try JSONDecoder().decode(WorkLogChange.self, from: JSONEncoder().encode(record))
        #expect(decoded.before == record.before && decoded.desired == record.desired && decoded.workspace == "scope")
    }
}

@Suite struct WorkInsightTests {
    var range: StatisticsRange { StatisticsRange(period: .week, anchor: localDate("2026-09-28T09:00:00")) }
    @Test func contextSwitchesIgnoreLongBreaksSameTaskAndDuplicateLogs() {
        let a = editableLog("a", length: 1800), b = editableLog("b", start: "2026-09-28T09:30:00", length: 1800)
        var c = editableLog("c", start: "2026-09-28T10:00:00", length: 1800); c.workItemId = 456
        var d = editableLog("d", start: "2026-09-28T12:00:00", length: 3600); d.workItemId = 789
        let result = ContextInsights.calculate(logs: [d, b, a, c, a], range: range)
        #expect(result.switches == 1 && result.longestBlock == 3600 && result.days.count == 7)
        #expect(result.averageBlock == 3000)
    }
    @Test func overlapsDoNotPretendToBeSwitchesOrUninterruptedWork() {
        let a = editableLog("a", length: 7200), b = editableLog("b", start: "2026-09-28T09:30:00")
        let result = ContextInsights.calculate(logs: [a,b], range: range)
        #expect(result.switches == 0 && result.longestBlock == 0 && result.ambiguousEntries == 2)
    }
    @Test func reportUsesRecordedWorkWithoutInventingOutcomesAndDeduplicatesNotes() {
        let log = editableLog(); let text = WeeklyReport.draft(logs: [log,log], range: range, targets: WorkTargets(), titles: [123:"Test ticket"])
        #expect(text.contains("Tracked: 1h 0m") && text.contains("Test ticket") && text.contains("[Add outcomes]"))
        #expect(text.components(separatedBy: "  - Development").count == 2)
        #expect(!text.contains("Completed Test ticket"))
    }
    @Test func htmlAndTicketDetailsHandleIdentityFieldsAndRejectUnsafeLinks() throws {
        let data = Data(#"{"id":123,"fields":{"System.Title":"Test","System.AssignedTo":{"displayName":"Alex"},"System.Description":"<p>Hello &amp; welcome</p><script>bad()</script><img src='https://example.com/pixel'>","Microsoft.VSTS.Common.AcceptanceCriteria":"<li>Done &#10003;</li>"},"relations":[{"url":"javascript:alert(1)"},{"url":"https://dev.azure.com/test/_apis/wit/workItems/456","attributes":{"name":"Parent"}}]}"#.utf8)
        let result = try TicketContext.decode(data, organizationURL: URL(string:"https://dev.azure.com/test")!)
        #expect(result.assignedTo == "Alex" && result.description == "Hello & welcome" && result.acceptanceCriteria == "• Done ✓")
        #expect(result.links.count == 1 && result.links[0].url.absoluteString == "https://dev.azure.com/test/_workitems/edit/456")
    }
}

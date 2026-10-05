import Foundation
import Testing
@testable import AzureTimetrackerCore

extension MutationFixture: OfflineDraftService {
    func activityTypes() -> [ActivityType] { [ActivityType(id: "dev", name: "Development")] }
}
actor DraftCheckpoint {
    var records: [OfflineDraft] = []
    let failAt: Int?
    init(failAt: Int? = nil) { self.failAt = failAt }
    func save(_ draft: OfflineDraft) throws {
        if records.count == failAt { throw AppError.message("Disk failure") }
        records.append(draft)
    }
}
@Suite struct OfflineDraftTests {
    func draft() -> OfflineDraft {
        OfflineDraft(workspace: "test", start: localDate("2026-09-28T09:00:00"), end: localDate("2026-09-28T10:00:00"), ticketID: 123, comment: "Offline work", activityID: "dev")
    }
    @Test func localTimerPersistsAndOnlyOneMayRunAcrossWorkspaces() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), file = OfflineDraftFile(url: folder.appendingPathComponent("drafts.json"))
        defer { try? FileManager.default.removeItem(at: folder) }
        var ledger = OfflineLedger(), active = draft(); active.end = nil
        try ledger.replace(active); try file.write(ledger)
        let restored = try file.read(); #expect(restored.drafts.first == active && restored.drafts.first?.running == true)
        #expect(throws: (any Error).self) { try ledger.replace(OfflineDraft(workspace: "other")) }
        let permissions = try FileManager.default.attributesOfItem(atPath: file.url.path)[.posixPermissions] as? Int
        #expect(permissions == 0o600)
        active.end = localDate("2026-09-28T10:00:00"); try ledger.replace(active); try ledger.replace(OfflineDraft(workspace: "other"))
        #expect(ledger.drafts.count == 2)
    }
    @Test func corruptFileIsNotSilentlyReset() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), file = OfflineDraftFile(url: folder.appendingPathComponent("drafts.json"))
        defer { try? FileManager.default.removeItem(at: folder) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let invalid = Data("invalid json".utf8); try invalid.write(to: file.url)
        #expect(throws: (any Error).self) { try file.read() }
        #expect(try Data(contentsOf: file.url) == invalid)
    }
    @Test func uploadsOnceWithDurableSendingCheckpointThenConfirmation() async throws {
        let api = try MutationFixture([]), capture = DraftCheckpoint(), review = try await OfflineSync.review(draft(), service: api)
        let result = try await OfflineSync.upload(review, workspace: "test", service: api) { try await capture.save($0) }
        #expect(result.status == .synced && result.remoteID != nil)
        #expect(await capture.records.map(\.status) == [.sending, .synced])
        #expect(await api.mutations == ["create"])
    }
    @Test func lostResponseNeedsReconciliationAndCannotReplay() async throws {
        let api = try MutationFixture([]), capture = DraftCheckpoint(), review = try await OfflineSync.review(draft(), service: api)
        await api.setLostCreate()
        await #expect(throws: (any Error).self) { try await OfflineSync.upload(review, workspace: "test", service: api) { try await capture.save($0) } }
        let records = await capture.records, pending = try #require(records.last)
        #expect(pending.status == .sending)
        let retry = try await OfflineSync.review(pending, service: api)
        #expect(retry.matches.count == 1)
        await #expect(throws: (any Error).self) { try await OfflineSync.upload(retry, workspace: "test", service: api) { try await capture.save($0) } }
        #expect(await api.mutations == ["create"])
    }
    @Test func checkpointFailureBeforeWritePreventsRequestAndAfterWritePreservesUncertainty() async throws {
        for stage in [0, 1] {
            let api = try MutationFixture([]), capture = DraftCheckpoint(failAt: stage), review = try await OfflineSync.review(draft(), service: api)
            await #expect(throws: (any Error).self) { try await OfflineSync.upload(review, workspace: "test", service: api) { try await capture.save($0) } }
            #expect(await api.mutations.count == stage)
            if stage == 1 { #expect(await capture.records.last?.status == .sending) }
        }
    }
    @Test func workspaceMismatchAndMissingActivityNeverWrite() async throws {
        let api = try MutationFixture([]), capture = DraftCheckpoint()
        let review = try await OfflineSync.review(draft(), service: api)
        await #expect(throws: (any Error).self) { try await OfflineSync.upload(review, workspace: "other", service: api) { try await capture.save($0) } }
        var missing = draft(); missing.activityID = "removed"
        let invalid = try await OfflineSync.review(missing, service: api)
        await #expect(throws: (any Error).self) { try await OfflineSync.upload(invalid, workspace: "test", service: api) { try await capture.save($0) } }
        #expect(await api.mutations.isEmpty)
    }
    @Test func overlapsAreAdvisoryButChangedOverlapRequiresReview() async throws {
        var log = editableLog(start: "2026-09-28T09:30:00", length: 3600); log.workItemId = 456
        let api = try MutationFixture([log]), capture = DraftCheckpoint(), review = try await OfflineSync.review(draft(), service: api)
        #expect(review.conflicts.count == 1 && review.matches.isEmpty)
        let result = try await OfflineSync.upload(review, workspace: "test", service: api) { try await capture.save($0) }
        #expect(result.status == .synced)
        let changedAPI = try MutationFixture([]), stale = try await OfflineSync.review(draft(), service: changedAPI)
        await changedAPI.replace(log)
        await #expect(throws: (any Error).self) { try await OfflineSync.upload(stale, workspace: "test", service: changedAPI) { try await capture.save($0) } }
        #expect(await changedAPI.mutations.isEmpty)
    }
    @Test func duplicateAppearingAfterReviewPreventsAnotherCreate() async throws {
        let api = try MutationFixture([]), review = try await OfflineSync.review(draft(), service: api), capture = DraftCheckpoint()
        _ = try await api.createWorkLog(draft().proposal())
        await #expect(throws: (any Error).self) { try await OfflineSync.upload(review, workspace: "test", service: api) { try await capture.save($0) } }
        #expect(await api.mutations == ["create"])
    }
    @Test func stoppingWithFractionalSecondsNeverRoundsIntoFuture() throws {
        let end = Date().addingTimeInterval(-0.01)
        let proposal = try WorkLogDraft(start: end.addingTimeInterval(-60), end: end, ticketID: 123, comment: nil, activityID: nil)
        #expect(proposal.edit.end <= end && proposal.seconds == 60 && proposal.allowDefaultActivity)
    }
    @Test func ticketFreeDraftNeedsCommentAndFutureTimeIsRejected() throws {
        var value = draft(); value.ticketID = nil; value.comment = ""
        #expect(throws: (any Error).self) { try value.proposal() }
        value.comment = "Daily standup"; #expect(try value.proposal().ticketID == nil)
        value.end = Date().addingTimeInterval(3600)
        #expect(throws: (any Error).self) { try value.proposal() }
    }
}

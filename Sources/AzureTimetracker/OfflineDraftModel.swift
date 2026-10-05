import Foundation
import Combine
import AzureTimetrackerCore

@MainActor final class OfflineDraftModel: ObservableObject {
    @Published private(set) var ledger = OfflineLedger()
    @Published private(set) var workspace = ""
    @Published private(set) var working = false
    @Published private(set) var issue: String?
    @Published private(set) var message: String?
    @Published private(set) var review: OfflineReview?
    @Published private(set) var configured = false
    private let file = OfflineDraftFile(url: LocalStore().file.deletingLastPathComponent().appendingPathComponent("offline-drafts.json"))
    #if UI_PREVIEW
    private let simulation = true
    #else
    private let simulation = ProcessInfo.processInfo.arguments.contains("--preview")
    #endif
    private var readable = true
    private var api: SevenPaceAPI?
    private var generation = UUID()
    var didSync: (() -> Void)?
    init() {
        guard !simulation else { return }
        do { ledger = try file.read() }
        catch { readable = false; issue = "Local drafts could not be read. The file has been preserved: " + error.localizedDescription }
    }
    var drafts: [OfflineDraft] { ledger.drafts.filter { $0.workspace == workspace }.sorted { $0.start > $1.start } }
    var active: OfflineDraft? { ledger.drafts.first { $0.running } }
    var activities: [ActivityType] { ledger.activities[workspace] ?? [] }
    var readyCount: Int { drafts.filter { !$0.running && $0.status != .synced }.count }
    var canCreate: Bool { readable && !workspace.isEmpty && !working }
    func configure(_ api: SevenPaceAPI?, workspace: String) {
        guard !working else { return }
        self.api = api; self.workspace = workspace; configured = api != nil; generation = UUID(); review = nil; message = nil
    }
    private func commit(_ next: OfflineLedger) throws {
        guard readable else { throw AppError.message("The saved drafts are unreadable; the original file has been preserved.") }
        if !simulation { try file.write(next) }
        ledger = next
    }
    private func checkpoint(_ draft: OfflineDraft) throws {
        var next = ledger; try next.replace(draft); try commit(next)
    }
    func cacheActivities(_ types: [ActivityType], workspace: String) {
        do { var next = ledger; next.activities[workspace] = types; try commit(next) }
        catch { issue = "Could not save activities for offline use: " + error.localizedDescription }
    }
    func save(_ draft: OfflineDraft) -> Bool {
        guard !working, draft.workspace == workspace, draft.status == .draft else { return false }
        do {
            if let old = ledger.drafts.first(where: { $0.id == draft.id }), old.status != .draft { throw AppError.message("An uploaded or unconfirmed draft cannot be edited.") }
            guard draft.ticketID.map({ $0 > 0 && $0 <= Int32.max }) ?? !draft.comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AppError.message("Choose a ticket or add a comment for ticket-free work.") }
            guard draft.start <= Date() else { throw AppError.message("The local timer cannot start in the future.") }
            if draft.end != nil { _ = try draft.proposal() }
            try checkpoint(draft); review = nil; issue = nil; message = draft.running ? "Local timer saved. This does not change the 7pace timer." : "Draft saved on this Mac."
            return true
        } catch { issue = error.localizedDescription; return false }
    }
    func stop() {
        guard !working, var draft = active else { return }
        do {
            draft.end = Date(); _ = try draft.proposal(); try checkpoint(draft); review = nil; issue = nil; message = "Local timer stopped. Review the draft before uploading."
        } catch { issue = error.localizedDescription }
    }
    func remove(_ draft: OfflineDraft) {
        guard !working, draft.status != .sending, ledger.drafts.contains(draft) else { return }
        do { var next = ledger; next.drafts.removeAll { $0.id == draft.id }; try commit(next); review = nil; issue = nil }
        catch { issue = error.localizedDescription }
    }
    func check(_ draft: OfflineDraft) async {
        #if UI_PREVIEW
        do {
            let fixture: [String: Any] = ["id": "33333333-3333-3333-3333-333333333333", "timestamp": WireDate.localString(draft.start.addingTimeInterval(1800)), "length": 3600, "workItemId": 33630, "comment": "Sample overlapping work"]
            let logs = try JSONDecoder().decode([WorkLog].self, from: JSONSerialization.data(withJSONObject: [fixture]))
            let state = try JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":"idle"}}"#.utf8))
            review = try OfflineReview(draft: draft, logs: logs, state: state)
        } catch { issue = error.localizedDescription }
        return
        #else
        guard let api, !working, draft.workspace == workspace, ledger.drafts.contains(draft) else { return }
        working = true; issue = nil; message = nil; review = nil; let token = generation
        defer { working = false }
        do {
            let types = try await api.activityTypes()
            guard generation == token else { return }; cacheActivities(types, workspace: workspace)
            let result = try await OfflineSync.review(draft, service: api)
            guard generation == token, !Task.isCancelled else { return }; review = result
        } catch { issue = error.localizedDescription }
        #endif
    }
    func upload() async {
        guard let api, let review, !working, ledger.drafts.contains(review.draft), review.draft.workspace == workspace else { return }
        working = true; issue = nil; message = nil
        defer { working = false }
        do {
            _ = try await OfflineSync.upload(review, workspace: workspace, service: api) { [weak self] draft in
                guard let self else { throw AppError.message("Draft storage is unavailable.") }
                try await self.checkpoint(draft)
            }
            self.review = nil; message = "Draft confirmed by 7pace."; didSync?()
        } catch {
            self.review = nil
            issue = error.localizedDescription
            if ledger.drafts.first(where: { $0.id == review.draft.id })?.status == .sending {
                issue = "Upload outcome is unconfirmed. Review this draft and check 7pace before retrying. " + error.localizedDescription
            }
        }
    }
    func link(_ log: WorkLog) async {
        guard let api, let review, !working, ledger.drafts.contains(review.draft), review.matches.contains(where: { $0.id == log.id }) else { return }
        working = true; defer { working = false }
        do {
            let fresh = try await api.workLog(id: log.id)
            guard try review.draft.proposal().matches(fresh) else { throw AppError.message("This entry changed. Refresh the review.") }
            var draft = review.draft; draft.status = .synced; draft.remoteID = fresh.id
            try checkpoint(draft); self.review = nil; issue = nil; message = "Linked to the existing 7pace entry. No time was added."; didSync?()
        } catch { issue = error.localizedDescription }
    }
    func allowRetryAfterManualCheck() {
        guard !working, let review, review.draft.status == .sending, review.matches.isEmpty, ledger.drafts.contains(review.draft) else { return }
        do {
            var draft = review.draft; draft.status = .draft; try checkpoint(draft); self.review = nil; issue = nil
            message = "Draft unlocked after your check. Review again before uploading."
        } catch { issue = error.localizedDescription }
    }
    #if UI_PREVIEW
    func preview(workspace: String, activities: [ActivityType]) {
        self.workspace = workspace; configured = true; ledger.activities[workspace] = activities
        ledger.drafts = [OfflineDraft(workspace: workspace, start: Date().addingTimeInterval(-5400), end: Date().addingTimeInterval(-1800), ticketID: 33984, comment: "Offline development", activityID: activities.first?.id)]
    }
    #endif
}

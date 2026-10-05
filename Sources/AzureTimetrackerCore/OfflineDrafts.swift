import Foundation

public enum OfflineDraftStatus: String, Codable, Sendable {
    case draft = "Local draft", sending = "Check 7pace before retrying", synced = "Synced to 7pace"
}
public struct OfflineDraft: Codable, Equatable, Identifiable, Sendable {
    public var id = UUID()
    public let workspace: String
    public var start: Date
    public var end: Date?
    public var ticketID: Int?
    public var comment: String
    public var activityID: String?
    public var billable = false
    public var status: OfflineDraftStatus = .draft
    public var remoteID: String?
    public init(workspace: String, start: Date = Date(), end: Date? = nil, ticketID: Int? = nil, comment: String = "", activityID: String? = nil) {
        self.workspace = workspace; self.start = start; self.end = end; self.ticketID = ticketID; self.comment = comment; self.activityID = activityID
    }
    public var running: Bool { end == nil && status == .draft }
    public var title: String { ticketID.map { "#" + String($0) } ?? comment.nonEmpty ?? "Untitled draft" }
    public func proposal() throws -> WorkLogDraft {
        guard let end else { throw AppError.message("Stop the local timer before reviewing this draft.") }
        return try WorkLogDraft(start: start, end: end, ticketID: ticketID, comment: comment.nonEmpty, activityID: activityID, billable: billable)
    }
}
public struct OfflineLedger: Codable, Sendable {
    public var drafts: [OfflineDraft] = []
    public var activities: [String: [ActivityType]] = [:]
    public init() {}
    public mutating func replace(_ draft: OfflineDraft) throws {
        guard !draft.workspace.isEmpty else { throw AppError.message("Set a 7pace workspace URL in Settings first.") }
        guard !draft.running || !drafts.contains(where: { $0.id != draft.id && $0.running }) else { throw AppError.message("Stop the existing local timer first.") }
        drafts.removeAll { $0.id == draft.id }; drafts.append(draft)
    }
}
public struct OfflineDraftFile: Sendable {
    public let url: URL
    public init(url: URL) { self.url = url }
    public func read() throws -> OfflineLedger {
        guard FileManager.default.fileExists(atPath: url.path) else { return OfflineLedger() }
        return try JSONDecoder().decode(OfflineLedger.self, from: Data(contentsOf: url))
    }
    public func write(_ ledger: OfflineLedger) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(ledger).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
public struct OfflineReview: Sendable {
    public let draft: OfflineDraft
    public let conflicts: [WorkLogConflict]
    public let overlapIssue: String?
    public let matches: [WorkLog]
    public init(draft: OfflineDraft, logs: [WorkLog], state: TrackingState) throws {
        self.draft = draft
        let proposal = try draft.proposal()
        matches = logs.filter { proposal.matches($0) }
        do { conflicts = try WorkLogOverlap.conflicts(edit: proposal.edit, excluding: "", logs: logs, state: state); overlapIssue = nil }
        catch { conflicts = []; overlapIssue = error.localizedDescription }
    }
    public var warningKey: String {
        (overlapIssue ?? "") + conflicts.map { $0.id + ":" + String($0.start.timeIntervalSince1970) + ":" + String($0.overlap.rounded()) }.sorted().joined(separator: "|")
    }
}
public protocol OfflineDraftService: WorkLogMutationService {
    func activityTypes() async throws -> [ActivityType]
}
extension SevenPaceAPI: OfflineDraftService {}

public enum OfflineSync {
    public static func review(_ draft: OfflineDraft, service: any OfflineDraftService) async throws -> OfflineReview {
        let proposal = try draft.proposal()
        let logs = try await service.workLogs(before: proposal.edit.end)
        let state = try await service.current().checked()
        return try OfflineReview(draft: draft, logs: logs, state: state)
    }
    public static func upload(_ reviewed: OfflineReview, workspace: String, service: any OfflineDraftService,
                              checkpoint: @Sendable (OfflineDraft) async throws -> Void) async throws -> OfflineDraft {
        let draft = reviewed.draft
        guard draft.workspace == workspace, draft.status == .draft else { throw AppError.message("This draft belongs to another workspace or has an unconfirmed upload. Review it before sending.") }
        let fresh = try await review(draft, service: service)
        guard fresh.matches.isEmpty else { throw AppError.message("A matching entry already exists. Refresh the review and link it instead of uploading again.") }
        guard fresh.warningKey == reviewed.warningKey else { throw AppError.message("Overlap details changed. Refresh the review before uploading.") }
        let activities = try await service.activityTypes()
        let selected = try ActivityChoice.resolve(draft.activityID ?? "", available: activities)
        guard selected == draft.activityID else { throw AppError.message("The saved activity is no longer available. Edit the draft’s activity.") }
        let proposal = try draft.proposal()
        try Task.checkCancellation()
        var pending = draft; pending.status = .sending
        // Persist BEFORE the request. If the response or final checkpoint is lost, never replay the create automatically.
        try await checkpoint(pending)
        let created = try await service.createWorkLog(proposal)
        guard UUID(uuidString: created.id) != nil, proposal.matches(created) else { throw AppError.message("7pace did not confirm this draft exactly. Check 7pace before retrying.") }
        pending.status = .synced; pending.remoteID = created.id
        try await checkpoint(pending)
        return pending
    }
}

/// Display policy only. Local time never participates in confirmed 7pace totals.
public enum LocalTimerDisplay {
    public static func isPrimary(local: OfflineDraft?, remoteRunning: Bool, remoteConfirmed: Bool) -> Bool {
        local?.running == true && !(remoteRunning && remoteConfirmed)
    }
    public static func elapsed(_ draft: OfflineDraft, at now: Date) -> Double {
        max(0, (draft.end ?? now).timeIntervalSince(draft.start))
    }
}

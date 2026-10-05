import Foundation

public struct WorkLogDraft: Codable, Equatable, Sendable {
    public var existingID: String?
    public var restoredID: String?
    public var start: Date
    public var seconds: Int
    public var billableSeconds: Int
    public var ticketID: Int?
    public var comment: String?
    public var activityID: String?
    public var userID: String?
    public var allowDefaultActivity = false
    public init(start: Date, end: Date, ticketID: Int?, comment: String?, activityID: String?, billable: Bool = false) throws {
        guard start.timeIntervalSince1970.isFinite, end.timeIntervalSince1970.isFinite, end <= Date() else { throw AppError.message("Choose valid times with no time in the future.") }
        let edit = WorkLogTimeEdit(start: Date(timeIntervalSince1970: floor(start.timeIntervalSince1970)), end: Date(timeIntervalSince1970: floor(end.timeIntervalSince1970))); try edit.validate()
        self.start = edit.start; seconds = edit.seconds; billableSeconds = billable ? seconds : 0
        self.ticketID = ticketID; self.comment = comment; self.activityID = activityID; allowDefaultActivity = activityID == nil
        try validate()
    }
    public init(_ log: WorkLog, existing: Bool = true) throws {
        guard let date = log.date, log.length.isFinite, log.length >= 1, log.length <= Double(Int32.max),
              (log.billableLength ?? log.length).isFinite, (log.billableLength ?? log.length) >= 0,
              (log.billableLength ?? log.length) <= Double(Int32.max) else { throw AppError.message("This entry has an invalid time or billable duration.") }
        existingID = existing ? log.id : nil; start = Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded()); seconds = Int(log.length.rounded())
        billableSeconds = Int((log.billableLength ?? log.length).rounded())
        ticketID = log.workItemId.flatMap { $0 > 0 ? $0 : nil }; comment = log.comment; activityID = log.activityType?.id; userID = log.user?.id
    }
    public var edit: WorkLogTimeEdit { WorkLogTimeEdit(start: start, end: start.addingTimeInterval(Double(seconds))) }
    public func validate() throws {
        try edit.validate()
        guard billableSeconds >= 0, billableSeconds <= Int32.max,
              ticketID.map({ $0 > 0 && $0 <= Int32.max }) ?? (comment?.nonEmpty != nil) else {
            throw AppError.message("Choose a valid ticket or add a comment for ticket-free time.")
        }
    }
    public func matches(_ log: WorkLog) -> Bool {
        edit.matches(log) && (log.workItemId.flatMap { $0 > 0 ? $0 : nil }) == ticketID &&
        (log.comment?.nonEmpty ?? "") == (comment?.nonEmpty ?? "") && (allowDefaultActivity || log.activityType?.id == activityID) &&
        (userID == nil || log.user?.id == userID) && abs((log.billableLength ?? log.length) - Double(billableSeconds)) < 1
    }
}

public struct WorkLogPlan: Codable, Sendable {
    public var title: String
    public var before: [WorkLog]
    public var desired: [WorkLogDraft]
    public var undoOf: UUID?
    public static func edit(_ log: WorkLog, time: WorkLogTimeEdit) throws -> Self {
        try time.validate(); var draft = try WorkLogDraft(log); draft.start = time.start; draft.seconds = time.seconds
        if log.billableLength == nil { draft.billableSeconds = time.seconds }
        return Self(title: "Edit time", before: [log], desired: [draft])
    }
    public static func split(_ log: WorkLog, at date: Date, secondTicket: Int?, secondComment: String?, secondActivity: String?) throws -> Self {
        var first = try WorkLogDraft(log), second = first
        let left = Int(date.timeIntervalSince(first.start).rounded())
        guard left > 0, left < first.seconds else { throw AppError.message("Choose a split time strictly inside the entry.") }
        second.existingID = nil; second.start = first.start.addingTimeInterval(Double(left)); second.seconds = first.seconds - left
        let leftBillable = Int((Double(first.billableSeconds) * Double(left) / Double(first.seconds)).rounded())
        second.billableSeconds = first.billableSeconds - leftBillable; first.billableSeconds = leftBillable; first.seconds = left
        second.ticketID = secondTicket; second.comment = secondComment; second.activityID = secondActivity; second.allowDefaultActivity = secondActivity == nil
        try first.validate(); try second.validate()
        return Self(title: "Split entry", before: [log], desired: [first, second])
    }
    public static func merge(_ logs: [WorkLog]) throws -> Self {
        let sorted = logs.sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        guard sorted.count >= 2, Set(sorted.map(\.id)).count == sorted.count else { throw AppError.message("Select at least two different entries to merge.") }
        var combined = try WorkLogDraft(sorted[0]); var end = combined.edit.end
        for log in sorted.dropFirst() {
            let next = try WorkLogDraft(log)
            guard next.ticketID == combined.ticketID, next.activityID == combined.activityID, next.comment == combined.comment, next.userID == combined.userID else {
                throw AppError.message("Merge entries with the same ticket, activity, comment and owner. Different work stays separate.")
            }
            guard abs(next.start.timeIntervalSince(end)) < 1 else { throw AppError.message("Only adjacent entries can be merged. Gaps and overlapping time are not filled or removed.") }
            combined.seconds += next.seconds; combined.billableSeconds += next.billableSeconds; end = next.edit.end
        }
        try combined.validate()
        return Self(title: "Merge \(sorted.count) entries", before: sorted, desired: [combined])
    }
    public static func undo(_ record: WorkLogChange) throws -> Self {
        guard record.status == .complete else { throw AppError.message("Only a confirmed, completed change can be undone.") }
        let existing = Set(record.after.map(\.id))
        let desired = try record.before.map { log -> WorkLogDraft in
            var draft = try WorkLogDraft(log, existing: existing.contains(log.id))
            if draft.existingID == nil { draft.restoredID = log.id }
            return draft
        }
        return Self(title: "Undo " + record.title.lowercased(), before: record.after, desired: desired, undoOf: record.id)
    }
}

public enum WorkLogChangeStatus: String, Codable, Sendable { case applying, complete, needsReview, reviewed, undone }
public struct WorkLogChange: Codable, Identifiable, Sendable {
    public var id = UUID()
    public var date = Date()
    public var workspace: String
    public var title: String
    public var before: [WorkLog]
    public var after: [WorkLog]
    public var desired: [WorkLogDraft]
    public var status: WorkLogChangeStatus = .applying
    public var detail: String = "Preparing change"
    public var undoOf: UUID?
    public init(plan: WorkLogPlan, workspace: String) {
        self.workspace = workspace; title = plan.title; before = plan.before; after = plan.before; desired = plan.desired; undoOf = plan.undoOf
    }
}

public protocol WorkLogMutationService: WorkLogEditingService {
    func findWorkLog(id: String) async throws -> WorkLog?
    func createWorkLog(_ draft: WorkLogDraft) async throws -> WorkLog
    func replaceWorkLogTime(id: String, draft: WorkLogDraft) async throws -> WorkLog
    func deleteWorkLog(id: String) async throws
}

public enum WorkLogOperations {
    public static func unchanged(_ actual: WorkLog, _ expected: WorkLog) -> Bool {
        actual.id == expected.id && actual.timestamp == expected.timestamp && actual.length == expected.length &&
        actual.editedTimestamp == expected.editedTimestamp && actual.workItemId == expected.workItemId &&
        actual.comment == expected.comment && actual.activityType?.id == expected.activityType?.id &&
        actual.user?.id == expected.user?.id && (actual.billableLength ?? actual.length) == (expected.billableLength ?? expected.length)
    }
    private static func verify(_ expected: WorkLog, deleting: Bool, service: any WorkLogMutationService) async throws {
        let actual = try await service.workLog(id: expected.id)
        guard unchanged(actual, expected) else { throw AppError.message("An affected entry changed in 7pace. Refresh before applying this change.") }
        guard actual.isCanEdit == true, !deleting || actual.isCanDelete == true else { throw AppError.message("7pace does not allow editing or deleting one of these entries. Check its approval state and permissions.") }
        let state = try await service.current().checked()
        try WorkLogOverlap.validateEditableEntry(id: expected.id, state: state)
    }
    public static func apply(_ plan: WorkLogPlan, workspace: String, service: any WorkLogMutationService,
                             checkpoint: @Sendable (WorkLogChange) async throws -> Void) async throws -> WorkLogChange {
        guard !plan.before.isEmpty, !plan.desired.isEmpty else { throw AppError.message("This change has no entries.") }
        for draft in plan.desired { try draft.validate() }
        let retained = Set(plan.desired.compactMap(\.existingID)), originals = Set(plan.before.map(\.id))
        guard originals.count == plan.before.count, retained.isSubset(of: originals), retained.count == plan.desired.compactMap(\.existingID).count else { throw AppError.message("This change contains duplicate or unknown entries.") }
        for log in plan.before { try await verify(log, deleting: !retained.contains(log.id), service: service) }
        for draft in plan.desired {
            if let oldID = draft.restoredID, try await service.findWorkLog(id: oldID) != nil { throw AppError.message("An entry scheduled for restoration already exists. Refresh before undoing.") }
        }
        var record = WorkLogChange(plan: plan, workspace: workspace)
        try await checkpoint(record)
        do {
            // Preserve every source until replacements have been confirmed. Each request is sent once.
            for draft in plan.desired.filter({ $0.existingID == nil }) {
                try Task.checkCancellation()
                for log in plan.before { try await verify(log, deleting: !retained.contains(log.id), service: service) }
                record.detail = "Creating a replacement entry; if interrupted, check 7pace before doing anything else."
                try await checkpoint(record)
                let created = try await service.createWorkLog(draft)
                record.after.append(created); try await checkpoint(record)
                guard UUID(uuidString: created.id) != nil, !originals.contains(created.id), draft.matches(created) else { throw AppError.message("7pace did not confirm the replacement entry as requested.") }
            }
            for draft in plan.desired where draft.existingID != nil {
                let id = draft.existingID!, original = plan.before.first { $0.id == id }!
                try await verify(original, deleting: false, service: service)
                record.detail = "Updating entry \(id)."; try await checkpoint(record)
                try Task.checkCancellation()
                let saved = try await service.replaceWorkLogTime(id: id, draft: draft)
                record.after.removeAll { $0.id == id }; record.after.append(saved); try await checkpoint(record)
                guard saved.id == id, draft.matches(saved) else { throw AppError.message("7pace did not confirm the updated entry as requested.") }
            }
            for original in plan.before where !retained.contains(original.id) {
                // Recheck replacements as well as the source before removing redundant time.
                for saved in record.after where saved.id != original.id && (retained.contains(saved.id) || !originals.contains(saved.id)) {
                    let actual = try await service.workLog(id: saved.id)
                    guard unchanged(actual, saved) else { throw AppError.message("A replacement entry changed before the merge finished. Check the change history.") }
                }
                try await verify(original, deleting: true, service: service)
                record.detail = "Removing original entry \(original.id)."; try await checkpoint(record)
                try Task.checkCancellation(); try await service.deleteWorkLog(id: original.id)
                guard try await service.findWorkLog(id: original.id) == nil else { throw AppError.message("7pace did not confirm removal of the original entry.") }
                record.after.removeAll { $0.id == original.id }; try await checkpoint(record)
            }
            record.status = .complete; record.detail = "Confirmed by 7pace"; try await checkpoint(record)
            return record
        } catch {
            record.status = .needsReview
            record.detail = record.detail + " Some changes may already be saved. No request was retried. " + error.localizedDescription
            try? await checkpoint(record)
            throw AppError.message(record.detail + " Review Recent edits and the actual entries in 7pace before continuing.")
        }
    }
}

import Foundation

public struct WorkLogTimeEdit: Equatable, Sendable {
    public let start: Date
    public let end: Date
    public var seconds: Int { Int(end.timeIntervalSince(start).rounded()) }
    public init(start: Date, end: Date) {
        self.start = Date(timeIntervalSince1970: start.timeIntervalSince1970.rounded())
        self.end = Date(timeIntervalSince1970: end.timeIntervalSince1970.rounded())
    }
    public func validate(now: Date = Date()) throws {
        let duration = end.timeIntervalSince(start)
        guard start.timeIntervalSince1970.isFinite, end.timeIntervalSince1970.isFinite,
              duration >= 1, duration <= Double(Int32.max), end <= now else {
            throw AppError.message("Choose an end after the start, with no time in the future.")
        }
        guard let roundTrip = WireDate.parse(WireDate.localString(start), localIfUnspecified: true),
              abs(roundTrip.timeIntervalSince(start)) < 1 else {
            throw AppError.message("This start time is ambiguous during a clock change. Choose an unambiguous local time.")
        }
    }
    public func matches(_ log: WorkLog) -> Bool {
        log.date.map { abs($0.timeIntervalSince(start)) < 1 } == true && abs(log.length - end.timeIntervalSince(start)) < 1
    }
}

public struct WorkLogConflict: Identifiable, Equatable, Sendable {
    public let id: String
    public let ticketID: Int?
    public let title: String
    public let start: Date
    public let end: Date
    public let active: Bool
    public let overlap: Double
}

public enum WorkLogOverlap {
    public static func validateEditableEntry(id: String, state: TrackingState) throws {
        let activeID = state.running ? state.track?.workLogId : nil
        if state.running, activeID?.nonEmpty == nil {
            throw AppError.message("7pace has a running timer without a worklog ID. Stop it before editing recorded time.")
        }
        guard activeID != id else { throw AppError.message("This entry is still running. Stop or pause it before editing.") }
    }
    public static func conflicts(edit: WorkLogTimeEdit, excluding id: String, logs: [WorkLog], state: TrackingState, now: Date = Date()) throws -> [WorkLogConflict] {
        try validateEditableEntry(id: id, state: state)
        var result: [WorkLogConflict] = []
        let activeID = state.running ? state.track?.workLogId : nil
        var seen = Set<String>()
        for log in logs where log.id != id && log.id != activeID && seen.insert(log.id).inserted {
            guard let start = log.date, log.length.isFinite, log.length >= 0 else {
                throw AppError.message("An existing entry has an unreadable time, so overlaps could not be fully checked.")
            }
            let end = start.addingTimeInterval(log.length)
            let overlap = min(end, edit.end).timeIntervalSince(max(start, edit.start))
            if overlap > 0 {
                result.append(WorkLogConflict(id: log.id, ticketID: log.workItemId, title: log.comment?.nonEmpty ?? "Tracked time", start: start, end: end, active: false, overlap: overlap))
            }
        }
        if state.running, let track = state.track, let activeID {
            guard let startText = track.currentTrackStartedDateTime,
                  let start = WireDate.parse(startText, localIfUnspecified: true) else {
                throw AppError.message("7pace did not provide the running timer’s start, so its overlaps could not be checked.")
            }
            let overlap = min(now, edit.end).timeIntervalSince(max(start, edit.start))
            if overlap > 0 { result.append(WorkLogConflict(id: activeID, ticketID: track.ticketID, title: track.title, start: start, end: now, active: true, overlap: overlap)) }
        }
        return result.sorted { $0.start < $1.start }
    }
}

public protocol WorkLogEditingService: Sendable {
    func current() async throws -> TrackingState
    func workLog(id: String) async throws -> WorkLog
    func workLogs(before end: Date) async throws -> [WorkLog]
    func updateWorkLogTime(id: String, edit: WorkLogTimeEdit) async throws -> WorkLog
}

public struct WorkLogEditReview: Sendable {
    public let original: WorkLog
    public let edit: WorkLogTimeEdit
    public let conflicts: [WorkLogConflict]
    public let overlapIssue: String?
    public init(original: WorkLog, edit: WorkLogTimeEdit, conflicts: [WorkLogConflict], overlapIssue: String? = nil) {
        self.original = original; self.edit = edit; self.conflicts = conflicts; self.overlapIssue = overlapIssue
    }
}
public struct WorkLogEditResult: Sendable {
    public let saved: WorkLog
    public let conflicts: [WorkLogConflict]
    public let overlapIssue: String?
}

public enum WorkLogEditing {
    public static func review(original: WorkLog, edit: WorkLogTimeEdit, service: any WorkLogEditingService) async throws -> WorkLogEditReview {
        try edit.validate()
        var logs: [WorkLog] = []
        var overlapIssue: String?
        do { logs = try await service.workLogs(before: edit.end) }
        catch is CancellationError { throw CancellationError() }
        catch {
            try Task.checkCancellation()
            overlapIssue = "The overlap check could not be completed. " + error.localizedDescription
        }
        // Read the edited entry after the potentially long history query.
        let current = try await service.workLog(id: original.id)
        guard current.isCanEdit == true else {
            throw AppError.message("7pace does not allow editing this entry. Its week may be locked, or your account may lack permission.")
        }
        guard current.id == original.id, current.timestamp == original.timestamp, current.length == original.length,
              current.editedTimestamp == original.editedTimestamp, current.workItemId == original.workItemId,
              current.comment == original.comment, current.activityType?.id == original.activityType?.id,
              current.billableLength == original.billableLength else {
            throw AppError.message("This entry changed in 7pace. Reload it before editing so another change is not overwritten.")
        }
        let state = try await service.current().checked()
        // Editing a live entry is separate from the advisory overlap check.
        try WorkLogOverlap.validateEditableEntry(id: original.id, state: state)
        var conflicts: [WorkLogConflict] = []
        if overlapIssue == nil {
            do { conflicts = try WorkLogOverlap.conflicts(edit: edit, excluding: original.id, logs: logs, state: state) }
            catch { overlapIssue = "The overlap check could not be completed. " + error.localizedDescription }
        }
        return WorkLogEditReview(original: current, edit: edit, conflicts: conflicts, overlapIssue: overlapIssue)
    }
    public static func save(original: WorkLog, edit: WorkLogTimeEdit, service: any WorkLogEditingService) async throws -> WorkLogEditResult {
        let fresh = try await review(original: original, edit: edit, service: service)
        try Task.checkCancellation()
        let saved = try await service.updateWorkLogTime(id: fresh.original.id, edit: fresh.edit)
        guard saved.id == fresh.original.id, fresh.edit.matches(saved) else {
            throw AppError.message("7pace did not confirm the requested time. Reload the entry before trying again.")
        }
        return WorkLogEditResult(saved: saved, conflicts: fresh.conflicts, overlapIssue: fresh.overlapIssue)
    }
}

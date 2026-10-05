import Foundation

public struct TimeCorrectionIssue: Identifiable, Equatable, Sendable {
    public enum Kind: String, Sendable { case gap, overlap }
    public var kind: Kind
    public var start: Date
    public var end: Date
    public var earlier: WorkLog?
    public var later: WorkLog?
    public var id: String { "\(kind)|\(start.timeIntervalSince1970)|\(earlier?.id ?? "")|\(later?.id ?? "")" }
    public var seconds: Double { end.timeIntervalSince(start) }
}

public enum TimeCorrections {
    /// Union coverage avoids inventing gaps inside nested or overlapping sessions.
    public static func issues(logs: [WorkLog], window: DateInterval, minimumGap: Double) throws -> [TimeCorrectionIssue] {
        var seen = Set<String>()
        var entries: [(WorkLog, Date, Date)] = []
        for log in logs where seen.insert(log.id).inserted {
            guard let start = log.date, log.length.isFinite, log.length >= 0, log.length <= Double(Int32.max) else { throw AppError.message("An entry has unreadable times. Refresh or correct it before reviewing gaps.") }
            guard log.length > 0 else { continue }
            let end = start.addingTimeInterval(log.length)
            if start < window.end && end > window.start { entries.append((log, start, end)) }
        }
        entries.sort { first, second in
            if first.1 == second.1 { return first.0.id < second.0.id }
            return first.1 < second.1
        }
        var result: [TimeCorrectionIssue] = [], covered = window.start, previous: WorkLog?
        for (i, entry) in entries.enumerated() {
            let (log, start, end) = entry
            if start.timeIntervalSince(covered) >= max(1, minimumGap) {
                result.append(.init(kind: .gap, start: covered, end: start, earlier: previous, later: log))
            }
            if end > covered { covered = end; previous = log }
            for next in entries.dropFirst(i + 1) {
                if next.1 >= end { break }
                let left = max(window.start, max(start, next.1)), right = min(window.end, min(end, next.2))
                if right > left { result.append(.init(kind: .overlap, start: left, end: right, earlier: log, later: next.0)) }
            }
        }
        if window.end.timeIntervalSince(covered) >= max(1, minimumGap), previous != nil {
            result.append(.init(kind: .gap, start: covered, end: window.end, earlier: previous, later: nil))
        }
        return result.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
    }
    public static func fillGap(_ issue: TimeCorrectionIssue, usingEarlier: Bool) throws -> WorkLogPlan {
        guard issue.kind == .gap, let log = usingEarlier ? issue.earlier : issue.later else { throw AppError.message("Choose a neighboring entry to fill this gap.") }
        let original = try WorkLogDraft(log)
        let edit = WorkLogTimeEdit(start: min(original.start, issue.start), end: max(original.edit.end, issue.end))
        var plan = try WorkLogPlan.edit(log, time: edit); plan.title = "Fill gap with neighboring task"
        return plan
    }
    /// Retains work on both sides. Explicit billable time is apportioned rather than duplicated.
    public static func removeInterval(_ log: WorkLog, start: Date, end: Date, separate: WorkLogDraft? = nil) throws -> WorkLogPlan {
        let source = try WorkLogDraft(log)
        let interval = WorkLogTimeEdit(start: start, end: end)
        let left = max(source.start, interval.start), right = min(source.edit.end, interval.end)
        guard right > left else { throw AppError.message("The selected interval is outside this entry. Refresh the recorded time.") }
        var ranges: [(Date, Date, Bool)] = []
        if left > source.start { ranges.append((source.start, left, false)) }
        if separate != nil { ranges.append((left, right, true)) }
        if right < source.edit.end { ranges.append((right, source.edit.end, false)) }
        guard !ranges.isEmpty else { throw AppError.message("This would remove the entire entry. Use a narrower interval, or separate the time into its own entry.") }
        var allocated = 0
        let desired = try ranges.enumerated().map { index, range -> WorkLogDraft in
            var draft = source
            draft.existingID = index == 0 && !range.2 ? source.existingID : nil
            draft.start = range.0; draft.seconds = Int(range.1.timeIntervalSince(range.0).rounded())
            draft.billableSeconds = Int((Double(source.billableSeconds) * Double(draft.seconds) / Double(source.seconds)).rounded())
            if separate != nil, index == ranges.count - 1 { draft.billableSeconds = source.billableSeconds - allocated }
            allocated += draft.billableSeconds
            if range.2, let separate {
                draft.ticketID = separate.ticketID; draft.comment = separate.comment; draft.activityID = separate.activityID; draft.allowDefaultActivity = separate.allowDefaultActivity
            }
            try draft.validate(); return draft
        }
        return WorkLogPlan(title: separate == nil ? "Remove interval from entry" : "Separate idle interval", before: [log], desired: desired)
    }
    public static func moveBoundary(_ issue: TimeCorrectionIssue, to boundary: Date) throws -> WorkLogPlan {
        guard issue.kind == .overlap, let a = issue.earlier, let b = issue.later else { throw AppError.message("Select two overlapping entries.") }
        let first = try WorkLogDraft(a), second = try WorkLogDraft(b)
        guard first.start < second.start, first.edit.end < second.edit.end,
              boundary >= issue.start, boundary <= issue.end else { throw AppError.message("Choose a boundary inside the overlap between two staggered entries.") }
        let left = try WorkLogPlan.edit(a, time: .init(start: first.start, end: boundary))
        let right = try WorkLogPlan.edit(b, time: .init(start: boundary, end: second.edit.end))
        // Preserve billable proportions as duplicate recorded time is removed.
        var desired = left.desired + right.desired
        for index in desired.indices {
            let source = index == 0 ? first : second
            desired[index].billableSeconds = Int((Double(source.billableSeconds) * Double(desired[index].seconds) / Double(source.seconds)).rounded())
        }
        return WorkLogPlan(title: "Correct overlapping boundary", before: [a, b], desired: desired)
    }
}

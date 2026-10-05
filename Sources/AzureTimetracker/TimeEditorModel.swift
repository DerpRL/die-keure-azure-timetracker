import Foundation
import Combine
import AzureTimetrackerCore

enum TimeEditMode: String, CaseIterable, Identifiable { case edit = "Edit time", split = "Split", merge = "Merge", undo = "Undo"; var id: Self { self } }

@MainActor final class TimeEditorModel: ObservableObject {
    @Published var day = Date()
    @Published var filter = ""
    @Published var selection = Set<String>()
    @Published private(set) var logs: [WorkLog] = []
    @Published private(set) var selected: WorkLog?
    @Published var start = Date() { didSet { review = nil } }
    @Published var end = Date() { didSet { review = nil } }
    @Published var mode = TimeEditMode.edit { didSet { review = nil } }
    @Published var splitAt = Date() { didSet { review = nil } }
    @Published var secondTicket = "" { didSet { review = nil } }
    @Published var secondComment = "" { didSet { review = nil } }
    @Published var secondActivity = "" { didSet { review = nil } }
    @Published private(set) var mergeLogs: [WorkLog] = []
    @Published private(set) var undoRecord: WorkLogChange?
    @Published private(set) var review: WorkLogEditReview?
    @Published private(set) var loading = false
    @Published private(set) var working = false
    @Published private(set) var issue: String?
    @Published private(set) var message: String?
    @Published private(set) var savedConflicts: [WorkLogConflict] = []
    @Published private(set) var savedOverlapIssue: String?
    @Published private(set) var changes: [WorkLogChange] = []
    @Published private(set) var journalIssue: String?
    @Published private(set) var needsReload = false
    @Published private(set) var connectionID = UUID()
    private var api: SevenPaceAPI?
    private var generation = UUID()
    private var workspace = ""
    private let journal = LocalDocument<[WorkLogChange]>("time-edit-history.json")
    private var journalReadable = true
    init() {
        do {
            changes = try journal.read() ?? []
            for i in changes.indices where changes[i].status == .applying {
                changes[i].status = .needsReview; changes[i].detail = "The app closed during this change. Check the affected entries in 7pace; no request will be replayed."
            }
        } catch { journalReadable = false; journalIssue = "Edit history could not be read. " + error.localizedDescription }
    }
    var configured: Bool { api != nil }
    var recentChanges: [WorkLogChange] { changes.filter { $0.workspace == workspace }.sorted { $0.date > $1.date } }
    var requiresReview: Bool { recentChanges.contains { $0.status == .needsReview || $0.status == .applying } }
    var edit: WorkLogTimeEdit { WorkLogTimeEdit(start: start, end: end) }
    var validationIssue: String? { do { _ = try proposedPlan(); return nil } catch { return error.localizedDescription } }
    var visibleLogs: [WorkLog] {
        let query = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: "#", with: "")
        return logs.filter { query.isEmpty || String($0.workItemId ?? 0).contains(query) || ($0.comment ?? "").lowercased().contains(query) }
    }
    func proposedPlan() throws -> WorkLogPlan {
        guard let selected else { throw AppError.message("Choose an entry.") }
        switch mode {
        case .edit: return try .edit(selected, time: edit)
        case .split:
            let text = secondTicket.trimmingCharacters(in: .whitespacesAndNewlines)
            guard text.isEmpty || (Int(text).map { $0 > 0 && $0 <= Int32.max } == true) else { throw AppError.message("Enter a valid ticket number, or leave it empty for comment-only time.") }
            return try .split(selected, at: splitAt, secondTicket: Int(text), secondComment: secondComment.nonEmpty, secondActivity: secondActivity.nonEmpty)
        case .merge: return try .merge(mergeLogs)
        case .undo:
            guard let undoRecord else { throw AppError.message("Choose a recent edit.") }; return try .undo(undoRecord)
        }
    }
    func configure(_ client: SevenPaceAPI?) {
        api = client; workspace = client?.baseURL.absoluteString.lowercased() ?? ""; generation = UUID(); connectionID = UUID(); logs = []; selected = nil; review = nil; selection = []
        issue = nil; message = nil; savedConflicts = []; savedOverlapIssue = nil; loading = false; working = false; needsReload = false; mergeLogs = []; undoRecord = nil
    }
    func cancel() { guard !working else { return }; generation = UUID(); selected = nil; review = nil; issue = nil; needsReload = false; undoRecord = nil; mergeLogs = [] }
    func load() async {
        guard let api, !working else { return }
        let request = UUID(); generation = request; loading = true; selected = nil; review = nil; issue = nil; selection = []
        let date = Calendar.current.startOfDay(for: day)
        defer { if generation == request { loading = false } }
        do {
            let end = Calendar.current.date(byAdding: .day, value: 1, to: date)!
            let result = try await api.workLogs(from: date, to: end, includeEditable: true)
            guard generation == request, !Task.isCancelled else { return }
            logs = result.filter { $0.date.map { $0 >= date && $0 < end } == true }
        } catch { if generation == request { issue = error.localizedDescription; logs = [] } }
    }
    func select(_ log: WorkLog) async {
        guard !working else { return }
        let request = UUID(); generation = request; working = true; loading = false; review = nil; issue = nil; message = nil
        savedConflicts = []; savedOverlapIssue = nil
        defer { if generation == request { working = false } }
        do {
            let current: WorkLog
            #if UI_PREVIEW
            current = log
            #else
            guard let api else { return }; current = try await api.workLog(id: log.id)
            #endif
            guard generation == request, !Task.isCancelled else { return }
            guard current.isCanEdit == true else { throw AppError.message("7pace does not allow editing this entry.") }
            let draft = try WorkLogDraft(current)
            start = draft.start; end = draft.edit.end; splitAt = draft.start.addingTimeInterval(Double(draft.seconds / 2))
            secondTicket = draft.ticketID.map(String.init) ?? ""; secondComment = draft.comment ?? ""; secondActivity = draft.activityID ?? ""
            needsReload = false; mode = .edit; undoRecord = nil; mergeLogs = []; selected = current
        } catch { if generation == request { issue = error.localizedDescription } }
    }
    func beginMerge() async {
        let candidates = visibleLogs.filter { selection.contains($0.id) }; guard candidates.count >= 2, !working else { return }
        working = true; issue = nil; let request = generation
        defer { if request == generation { working = false } }
        do {
            var fresh: [WorkLog] = []
            for log in candidates {
                #if UI_PREVIEW
                fresh.append(log)
                #else
                guard let api else { return }; fresh.append(try await api.workLog(id: log.id))
                #endif
            }
            _ = try WorkLogPlan.merge(fresh)
            guard generation == request else { return }
            mergeLogs = fresh; mode = .merge; review = nil; needsReload = false; selected = fresh[0]
        } catch { if generation == request { issue = error.localizedDescription } }
    }
    func beginUndo(_ record: WorkLogChange) {
        guard !working, record.workspace == workspace else { return }
        do { _ = try WorkLogPlan.undo(record); undoRecord = record; mode = .undo; review = nil; issue = nil; needsReload = false; selected = record.after.first }
        catch { issue = error.localizedDescription }
    }
    private func check(_ plan: WorkLogPlan) async throws -> WorkLogEditReview {
        let historical: [WorkLog], state: TrackingState
        do {
            #if UI_PREVIEW
            historical = logs; state = try JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":"idle"}}"#.utf8))
            #else
            guard let api else { throw AppError.message("Connect to 7pace first.") }
            historical = try await api.workLogs(before: plan.desired.map(\.edit.end).max()!)
            state = try await api.current()
            #endif
            let originalIDs = Set(plan.before.map(\.id)); var found: [String: WorkLogConflict] = [:]
            for draft in plan.desired {
                for conflict in try WorkLogOverlap.conflicts(edit: draft.edit, excluding: plan.before[0].id, logs: historical.filter { !originalIDs.contains($0.id) }, state: state) { found[conflict.id] = conflict }
            }
            return WorkLogEditReview(original: plan.before[0], edit: plan.desired[0].edit, conflicts: found.values.sorted { $0.start < $1.start })
        } catch is CancellationError { throw CancellationError() }
        catch { try Task.checkCancellation(); return WorkLogEditReview(original: plan.before[0], edit: plan.desired[0].edit, conflicts: [], overlapIssue: "Overlap check incomplete. " + error.localizedDescription) }
    }
    func checkChanges() async {
        guard !working, !needsReload else { return }; working = true; issue = nil; review = nil; let request = generation
        defer { if request == generation { working = false } }
        do { let plan = try proposedPlan(); let checked = try await check(plan); guard request == generation else { return }; review = checked }
        catch { if request == generation { issue = error.localizedDescription } }
    }
    private func checkpoint(_ record: WorkLogChange) throws {
        guard journalReadable else { throw AppError.message(journalIssue ?? "Edit history is unavailable.") }
        var next = changes.filter { $0.id != record.id }; next.append(record)
        if record.status == .complete, let parent = record.undoOf, let index = next.firstIndex(where: { $0.id == parent }) { next[index].status = .undone }
        try journal.write(next); changes = next; journalIssue = nil
    }
    func acknowledge(_ record: WorkLogChange) {
        guard !working, record.workspace == workspace else { return }
        var updated = record; updated.status = .reviewed; updated.detail += " User acknowledged checking the entries in 7pace."
        do { try checkpoint(updated) } catch { journalIssue = error.localizedDescription }
    }
    func save() async -> Bool {
        guard let api, selected != nil, !working, !needsReload, !requiresReview else { return false }
        working = true; issue = nil; message = nil; let request = generation
        defer { if request == generation { working = false } }
        do {
            let plan = try proposedPlan(); let overlaps = try await check(plan)
            let result = try await WorkLogOperations.apply(plan, workspace: workspace, service: api) { [weak self] record in
                guard let self else { throw AppError.message("The editor closed before the change finished.") }
                try await self.checkpoint(record)
            }
            guard request == generation else { return false }
            savedConflicts = overlaps.conflicts; savedOverlapIssue = overlaps.overlapIssue
            message = result.title + " confirmed by 7pace. You can undo this from Recent edits."
            selected = nil; review = nil; selection = []; return true
        } catch {
            if request == generation { review = nil; needsReload = true; issue = error.localizedDescription }
            return false
        }
    }
    #if UI_PREVIEW
    func useInterfacePreview(_ sample: [WorkLog]) {
        logs = sample; workspace = "preview"
        if let current = sample.first, let date = current.date {
            var original = current; original.length /= 2
            if let plan = try? WorkLogPlan.edit(original, time: WorkLogTimeEdit(start: date, end: date.addingTimeInterval(current.length))) {
                var record = WorkLogChange(plan: plan, workspace: "preview"); record.after = [current]; record.status = .complete; record.detail = "Confirmed preview edit"
                changes = [record]
            }
        }
    }
    #endif
}

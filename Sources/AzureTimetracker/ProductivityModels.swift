import AppKit
import Combine
import AzureTimetrackerCore

struct LocalDocument<Value: Codable> {
    let url: URL
    init(_ name: String) { url = LocalStore().file.deletingLastPathComponent().appendingPathComponent(name) }
    func read() throws -> Value? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(Value.self, from: Data(contentsOf: url))
    }
    func write(_ value: Value) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
struct TicketContextRequest: Identifiable { let id: Int }
@MainActor final class TicketContextModel: ObservableObject {
    @Published private(set) var details: TicketContext?
    @Published private(set) var issue: String?
    @Published private(set) var loading = false
    private var api: AzureAPI?
    private var generation = UUID()
    func configure(_ api: AzureAPI?) { self.api = api; generation = UUID(); details = nil; issue = nil; loading = false }
    func load(_ id: Int) async {
        let request = UUID(); generation = request; details = nil; issue = nil
        #if UI_PREVIEW
        let sample: [String: Any] = ["id": id, "fields": ["System.Title": "Sample feature work", "System.State": "Active", "System.WorkItemType": "User Story", "System.TeamProject": "Sample project", "System.AssignedTo": ["displayName": "Preview user"], "System.Description": "<p>Improve the recorded-time workflow.</p>", "Microsoft.VSTS.Common.AcceptanceCriteria": "<ul><li>Keep entry totals correct</li><li>Show clear actions</li></ul>"]]
        details = try? TicketContext.decode(JSONSerialization.data(withJSONObject: sample), organizationURL: URL(string: "https://dev.azure.com/preview")!); return
        #else
        guard let api else { issue = "Add your Azure organization and PAT in Settings to load ticket details."; return }
        loading = true; defer { if generation == request { loading = false } }
        do { let result = try await api.ticketContext(id: id); guard generation == request, !Task.isCancelled else { return }; details = result }
        catch { if generation == request { issue = error.localizedDescription } }
        #endif
    }
}

@MainActor final class WeeklyReportModel: ObservableObject {
    @Published private(set) var anchor = Date()
    @Published private(set) var loading = false
    @Published private(set) var issue: String?
    @Published private(set) var storageIssue: String?
    @Published private(set) var message: String?
    @Published private(set) var syncedAt: Date?
    @Published private(set) var logs: [WorkLog] = []
    @Published private(set) var loadedRange: StatisticsRange?
    @Published var text = "" { didSet { if !replacing { saveDraft() } } }
    private var api: SevenPaceAPI?
    private var workspace = ""
    private var generation = UUID()
    private var replacing = false
    private var drafts: [String: String] = [:]
    private let file = LocalDocument<[String: String]>("weekly-report-drafts.json")
    private var storageReadable = true
    var range: StatisticsRange { StatisticsRange(period: .week, anchor: anchor) }
    var configured: Bool { api != nil }
    var hasData: Bool { loadedRange == range }
    init() { do { drafts = try file.read() ?? [:] } catch { storageReadable = false; storageIssue = "Saved drafts could not be read: " + error.localizedDescription } }
    private var key: String { workspace + "|" + WireDate.localString(range.start) }
    private func setText(_ value: String) { replacing = true; text = value; replacing = false }
    func configure(_ api: SevenPaceAPI?) {
        self.api = api; workspace = api?.baseURL.absoluteString.lowercased() ?? ""; generation = UUID(); loading = false
        logs = []; loadedRange = nil; syncedAt = nil; issue = nil; message = nil; setText(drafts[key] ?? "")
    }
    func invalidate() { generation = UUID(); loading = false; logs = []; loadedRange = nil; syncedAt = nil }
    func changeDate(_ date: Date) { anchor = date; generation = UUID(); loading = false; logs = []; loadedRange = nil; syncedAt = nil; issue = nil; message = nil; setText(drafts[key] ?? "") }
    func move(_ amount: Int) { changeDate(range.shifted(amount).start) }
    func saveDraft() {
        guard storageReadable, !workspace.isEmpty else { return }
        var updated = drafts; updated[key] = text
        do { try file.write(updated); drafts = updated; storageIssue = nil }
        catch { storageIssue = "Draft is in memory but could not be saved: " + error.localizedDescription }
    }
    func load() async {
        guard let api else { return }; let request = UUID(), expected = range; generation = request; loading = true; issue = nil
        defer { if generation == request { loading = false } }
        do {
            let result = try await api.workLogs(from: expected.start, to: expected.end)
            guard generation == request, range == expected, !Task.isCancelled else { return }
            logs = result; loadedRange = expected; syncedAt = Date()
        } catch { if generation == request { issue = error.localizedDescription } }
    }
    func generate(targets: WorkTargets, titles: [Int: String]) {
        guard hasData else { return }
        text = WeeklyReport.draft(logs: logs, range: range, targets: targets, titles: titles); message = "Draft generated. Review outcomes and blockers before sharing."
    }
    func copy() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string); message = "Draft copied." }
    func export() {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "weekly-status-" + String(WireDate.localString(range.start).prefix(10)) + ".md"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try text.write(to: url, atomically: true, encoding: .utf8); message = "Draft exported." } catch { issue = error.localizedDescription }
    }
    #if UI_PREVIEW
    func useInterfacePreview(_ sample: [WorkLog]) { logs = sample; loadedRange = range; syncedAt = Date() }
    #endif
}

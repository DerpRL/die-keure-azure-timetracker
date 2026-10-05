import Foundation
import Combine
import AzureTimetrackerCore

@MainActor final class DayReviewModel: ObservableObject {
    @Published var selectedDay = Date()
    @Published private(set) var connectionID = UUID()
    @Published private(set) var logs: [WorkLog] = []
    @Published private(set) var loadedDay: Date?
    @Published private(set) var syncedAt: Date?
    @Published private(set) var loading = false
    @Published private(set) var issue: String?
    private var api: SevenPaceAPI?
    private var generation = UUID()
    private var pendingDay: Date?
    private var lastAttempt = Date.distantPast
    private var attemptedDay: Date?
    var day: Date { Calendar.current.startOfDay(for: selectedDay) }
    var configured: Bool { api != nil }
    #if UI_PREVIEW
    func useInterfacePreview(_ sample: [WorkLog]) {
        logs = sample; selectedDay = Date(); loadedDay = day; syncedAt = Date()
    }
    #endif
    func configure(_ client: SevenPaceAPI?) {
        api = client; generation = UUID(); connectionID = UUID()
        logs = []; loadedDay = nil; syncedAt = nil; issue = nil; loading = false; pendingDay = nil; attemptedDay = nil
    }
    func invalidate() { lastAttempt = .distantPast }
    func load(force: Bool = false) async {
        guard let api else { return }
        let requested = day
        if loading, pendingDay == requested { return }
        if !force, attemptedDay == requested, (issue != nil || loadedDay == requested), Date().timeIntervalSince(lastAttempt) < 60 { return }
        let request = UUID(); generation = request; pendingDay = requested
        loading = true; issue = nil; lastAttempt = Date(); attemptedDay = requested
        if loadedDay != requested { logs = []; loadedDay = nil; syncedAt = nil }
        defer { if generation == request { loading = false; pendingDay = nil; if Task.isCancelled { lastAttempt = .distantPast } } }
        do {
            let start = Calendar.current.date(byAdding: .day, value: -1, to: requested)!
            let end = Calendar.current.date(byAdding: .day, value: 1, to: requested)!
            let result = try await api.workLogs(from: start, to: end)
            guard generation == request, requested == day, !Task.isCancelled else { return }
            logs = result; loadedDay = requested; syncedAt = Date()
        } catch {
            guard generation == request, requested == day, !Task.isCancelled else { return }
            issue = error.localizedDescription
        }
    }
}

import Foundation
import Combine
import AzureTimetrackerCore

@MainActor final class StatisticsModel: ObservableObject {
    @Published var period: StatisticsPeriod = .week
    @Published var anchor = Date()
    @Published var filter = ExplorerFilter() { didSet { if filter != oldValue { rebuild() } } }
    @Published private(set) var connectionID = UUID()
    @Published private(set) var loading = false
    @Published private(set) var analyzing = false
    @Published private(set) var issue: String?
    @Published private(set) var syncedAt: Date?
    @Published private(set) var loadedRange: StatisticsRange?
    @Published private(set) var analysis: ExplorerAnalysis?
    @Published private(set) var visuals: ExplorerVisuals?
    @Published private(set) var focus: DateInterval?
    @Published private(set) var zoomHistory: [DateInterval] = []
    @Published private(set) var availableActivities: [ExplorerActivity] = []
    @Published private(set) var omitted = 0
    #if UI_PREVIEW
    private var previewLogs: [WorkLog]?
    #endif
    private var api: SevenPaceAPI?
    private var dataset = ExplorerDataset(logs: [])
    private var targets = WorkTargets()
    private var titles: [Int: String] = [:]
    private var generation = UUID()
    private var analysisGeneration = UUID()
    private var analysisTask: Task<Void, Never>?
    private var pendingRange: StatisticsRange?
    private var lastAttempt = Date.distantPast
    private var lastAttemptRange: StatisticsRange?
    var range: StatisticsRange { StatisticsRange(period: period, anchor: anchor) }
    var bounds: DateInterval { DateInterval(start: range.start, end: range.end) }
    var window: DateInterval { focus ?? bounds }
    var isZoomed: Bool { window != bounds }
    var configured: Bool { api != nil }
    var ticketIDs: [Int] { Array(Set(dataset.records.compactMap(\.ticketID))).sorted() }

    func configure(_ client: SevenPaceAPI?, targets: WorkTargets = WorkTargets()) {
        self.targets = targets; api = client; generation = UUID(); connectionID = UUID()
        analysisTask?.cancel(); analysisGeneration = UUID(); analyzing = false
        loading = false; pendingRange = nil; issue = nil; dataset = ExplorerDataset(logs: [])
        analysis = nil; visuals = nil; loadedRange = nil; syncedAt = nil; lastAttempt = .distantPast; lastAttemptRange = nil
        focus = nil; zoomHistory = []; availableActivities = []; omitted = 0; titles = [:]; filter = ExplorerFilter()
    }
    func invalidate() { lastAttempt = .distantPast }
    func move(_ amount: Int) { anchor = range.shifted(amount).start }
    func current() { anchor = Date() }
    func updateTitles(_ values: [Int: WorkItem]) {
        let names = values.mapValues(\.title)
        guard names != titles else { return }; titles = names; rebuild()
    }
    func zoom(to interval: DateInterval) {
        let next = StatisticsZoom.bounded(interval, within: bounds)
        guard next != window else { return }
        zoomHistory.append(window); focus = next; rebuild()
    }
    func scale(_ factor: Double) { zoom(to: StatisticsZoom.scaled(window, factor: factor, within: bounds)) }
    func pan(_ direction: Int) { zoom(to: StatisticsZoom.shifted(window, direction: direction, within: bounds)) }
    func back() { guard let previous = zoomHistory.popLast() else { return }; focus = previous; rebuild() }
    func resetZoom() { focus = nil; zoomHistory = []; rebuild() }
    func clearFilters() { filter = ExplorerFilter() }

    func load(force: Bool = false) async {
        let requested = range
        #if UI_PREVIEW
        if let previewLogs {
            if loadedRange != requested || force { install(ExplorerDataset(logs: previewLogs), range: requested) }
            return
        }
        #endif
        guard let api else { return }
        if loading, pendingRange == requested { return }
        if !force, lastAttemptRange == requested,
           (issue != nil || (loadedRange == requested && syncedAt != nil)),
           Date().timeIntervalSince(lastAttempt) < (issue == nil ? 300 : 60) { return }
        let requestID = UUID(); generation = requestID; pendingRange = requested
        loading = true; lastAttempt = Date(); lastAttemptRange = requested; issue = nil
        if loadedRange != requested {
            analysisTask?.cancel(); analysisGeneration = UUID(); analysis = nil; visuals = nil; analyzing = false
            loadedRange = nil; syncedAt = nil; focus = nil; zoomHistory = []
        }
        defer {
            if generation == requestID {
                loading = false; pendingRange = nil
                if Task.isCancelled { lastAttempt = .distantPast }
            }
        }
        do {
            // The API filters by reported start date. Include yesterday for ordinary overnight entries.
            let from = Calendar.current.date(byAdding: .day, value: -1, to: requested.start)!
            let result = try await api.workLogs(from: from, to: requested.end)
            let parsed = await Task.detached(priority: .userInitiated) { ExplorerDataset(logs: result) }.value
            guard generation == requestID, range == requested, !Task.isCancelled else { return }
            install(parsed, range: requested)
        } catch {
            guard generation == requestID, range == requested, !Task.isCancelled else { return }
            issue = error.localizedDescription
        }
    }
    private func install(_ value: ExplorerDataset, range requested: StatisticsRange) {
        if loadedRange != requested { focus = nil; zoomHistory = [] }
        dataset = value; omitted = value.omitted; loadedRange = requested; syncedAt = Date()
        let records = value.records.filter { $0.start < requested.end && $0.end > requested.start }
        availableActivities = Dictionary(grouping: records, by: \.activityID).map { key, records in
            ExplorerActivity(id: key, name: records[0].activityName, seconds: 0)
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        rebuild()
    }
    private func rebuild() {
        guard loadedRange == range else { return }
        analysisTask?.cancel(); let token = UUID(); analysisGeneration = token; analyzing = true
        let dataset = dataset, window = window, filter = filter, titles = titles, targets = targets, requested = range
        analysisTask = Task {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            let result = await Task.detached(priority: .userInitiated) {
                let analysis = dataset.analyze(window: window, filter: filter, titles: titles, targets: targets)
                return (analysis, ExplorerVisuals(analysis: analysis, targets: targets))
            }.value
            guard !Task.isCancelled, analysisGeneration == token, range == requested else { return }
            visuals = result.1; analysis = result.0; analyzing = false
        }
    }
    #if UI_PREVIEW
    func useInterfacePreview(_ sample: [WorkLog]) { previewLogs = sample; install(ExplorerDataset(logs: sample), range: range) }
    #endif
}

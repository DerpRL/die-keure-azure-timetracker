import SwiftUI
import Charts
import Combine
import AzureTimetrackerCore

struct ComparisonRequest: Equatable {
    let current: StatisticsRange
    let previous: StatisticsRange
    let elapsed: Bool
    let filter: ExplorerFilter
    let titles: [Int: String]
    let sourceSync: Date?
}
@MainActor final class ComparisonModel: ObservableObject {
    @Published var result: PeriodComparison?
    @Published var loading = false
    @Published var issue: String?
    private var api: SevenPaceAPI?
    private var targets = WorkTargets()
    private var generation = UUID()
    private var cache: ExplorerDataset?
    private var cachedThrough = Date.distantPast
    private var cachedAt = Date.distantPast
    private var cachedSourceSync: Date?
    #if UI_PREVIEW
    private var previewLogs: [WorkLog]?
    func preview(_ logs: [WorkLog]) { previewLogs = logs }
    #endif
    func configure(_ api: SevenPaceAPI?, targets: WorkTargets) {
        self.api = api; self.targets = targets; generation = UUID(); loading = false; result = nil; issue = nil
        cache = nil; cachedThrough = .distantPast; cachedAt = .distantPast; cachedSourceSync = nil
    }
    func invalidate() { cachedAt = .distantPast }
    private func fetch(_ through: Date) async throws -> ExplorerDataset {
        #if UI_PREVIEW
        if let previewLogs { return ExplorerDataset(logs: previewLogs) }
        #endif
        guard let api else { throw AppError.message("Connect to 7pace to compare periods.") }
        return ExplorerDataset(logs: try await api.workLogs(before: through))
    }

    func load(_ request: ComparisonRequest, force: Bool = false) async {
        let token = UUID(); generation = token; loading = true; issue = nil; result = nil
        defer { if generation == token { loading = false } }
        do {
            let through = max(request.current.end, request.previous.end)
            var dataset = cache
            #if UI_PREVIEW
            if let previewLogs { dataset = ExplorerDataset(logs: previewLogs) }
            #endif
            let needsFetch = dataset == nil || force || cachedThrough < through || Date().timeIntervalSince(cachedAt) > 300 || cachedSourceSync != request.sourceSync
            if needsFetch {
                dataset = try await fetch(through)
            }
            guard generation == token, !Task.isCancelled, let dataset else { return }
            if needsFetch { cache = dataset; cachedThrough = through; cachedAt = Date(); cachedSourceSync = request.sourceSync }
            let targets = targets, now = Date()
            let value = await Task.detached(priority: .userInitiated) {
                let (a, b) = PeriodComparison.windows(current: request.current, previous: request.previous, matchElapsed: request.elapsed, now: now)
                // Use a consistent resolution for both periods, even when a partial range is short.
                let resolution: ExplorerResolution = switch request.current.period { case .day: .hour; case .week, .month: .day; case .year: .month }
                return PeriodComparison(current: dataset.analyze(window: a, filter: request.filter, titles: request.titles, targets: targets, resolution: resolution),
                                        previous: dataset.analyze(window: b, filter: request.filter, titles: request.titles, targets: targets, resolution: resolution))
            }.value
            guard generation == token, !Task.isCancelled else { return }; result = value
        } catch { if generation == token, !Task.isCancelled { issue = error.localizedDescription } }
    }
}

struct ComparisonView: View {
    @ObservedObject var statistics: StatisticsModel
    @ObservedObject var comparison: ComparisonModel
    let titles: [Int: WorkItem]
    let inspectTask: (String) -> Void
    let loadTitle: @MainActor (Int) async -> Void
    @ViewState private var custom = false
    @ViewState private var anchor = Calendar.current.date(byAdding: .weekOfYear, value: -1, to: Date())!
    @ViewState private var elapsed = true
    @ViewState<String?> private var selected: String? = nil
    @ViewState private var limit = 10
    private var request: ComparisonRequest {
        ComparisonRequest(current: statistics.range, previous: custom ? StatisticsRange(period: statistics.period, anchor: anchor) : statistics.range.shifted(-1),
                          elapsed: elapsed, filter: statistics.filter, titles: titles.mapValues(\.title), sourceSync: statistics.syncedAt)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionCard {
                HStack {
                    Picker("Compare with", selection: $custom) { Text("Previous period").tag(false); Text("Choose period").tag(true) }.frame(maxWidth: 320)
                    if custom { DatePicker("Contains date", selection: $anchor, in: ...Date(), displayedComponents: .date) }
                    Spacer()
                    Button("Refresh comparison") { Task { await comparison.load(request, force: true) } }.disabled(comparison.loading)
                }
                Toggle("Match elapsed days and time for the current period", isOn: $elapsed)
                Text("Compares the selected periods using the same filters. Explorer zoom is ignored. Targets cover the included calendar days and reflect holidays and leave. More recorded time does not necessarily mean more productive work.").font(.callout).foregroundStyle(Palette.secondary)
            }
            if comparison.loading { ProgressView("Comparing recorded time…").padding() }
            if let issue = comparison.issue { SectionCard { Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning) } }
            if let result = comparison.result {
                SectionCard {
                    HStack(alignment: .top) {
                        periodSummary("Selected", result.current, color: Palette.accent)
                        Spacer(); Image(systemName: "arrow.left.arrow.right"); Spacer()
                        periodSummary("Comparison", result.previous, color: .blue)
                    }
                    Divider()
                    HStack {
                        metric("Recorded", a: result.current.total, b: result.previous.total)
                        Spacer(); metric("Target", a: result.current.target, b: result.previous.target)
                        Spacer(); metric("Average entry", a: result.current.count > 0 ? result.current.total / Double(result.current.count) : 0,
                                         b: result.previous.count > 0 ? result.previous.total / Double(result.previous.count) : 0)
                    }
                }
                SectionCard {
                    Text("Time through each period").font(.headline)
                    Text("Aligned by hour, day or month position. Select a bar to see its exact dates.").font(.caption).foregroundStyle(Palette.secondary)
                    Chart(result.buckets) { bucket in
                        if let a = bucket.current {
                            BarMark(x: .value("Position", String(bucket.id + 1)), y: .value("Hours", a.seconds / 3600), width: .ratio(0.7))
                                .foregroundStyle(by: .value("Period", "Selected")).position(by: .value("Period", "Selected"))
                                .accessibilityLabel("Selected " + label(a)).accessibilityValue(DurationText.short(a.seconds))
                        }
                        if let b = bucket.previous {
                            BarMark(x: .value("Position", String(bucket.id + 1)), y: .value("Hours", b.seconds / 3600), width: .ratio(0.7))
                                .foregroundStyle(by: .value("Period", "Comparison")).position(by: .value("Period", "Comparison"))
                                .accessibilityLabel("Comparison " + label(b)).accessibilityValue(DurationText.short(b.seconds))
                        }
                    }.chartForegroundStyleScale(["Selected": Palette.accent, "Comparison": Color.blue])
                        .chartXSelection(value: $selected).chartXAxisLabel(statistics.period == .year ? "Month of year" : statistics.period == .day ? "Hour position (1 = start of day)" : "Day of period")
                        .chartYAxisLabel("Hours").frame(height: 250)
                    Picker("Inspect interval", selection: $selected) {
                        Text("Choose an interval…").tag(nil as String?)
                        ForEach(result.buckets) { bucket in
                            Text(String(bucket.id + 1) + " · " + detail(bucket.current) + " vs " + detail(bucket.previous)).tag(Optional(String(bucket.id + 1)))
                        }
                    }
                    if let selected, let bucket = result.buckets.first(where: { String($0.id + 1) == selected }) {
                        HStack { Text("Selected: " + detail(bucket.current)); Spacer(); Text("Comparison: " + detail(bucket.previous)) }.font(.callout).monospacedDigit()
                    }
                }
                SectionCard {
                    Text("Activity changes").font(.headline)
                    columnHeadings
                    ForEach(result.activities) { row in deltaRow(row) }
                    if result.activities.isEmpty { Text("No recorded activity in either period.") }
                }
                SectionCard {
                    Text("Largest task changes").font(.headline)
                    columnHeadings
                    ForEach(Array(result.tasks.prefix(limit))) { row in
                        HStack { deltaRow(row); Button("Explore") { inspectTask(row.id) }.accessibilityLabel("Explore " + row.title) }
                    }
                    if result.tasks.count > limit { Button("Show more tasks") { limit += 10 } }
                    if result.tasks.isEmpty { Text("No tasks match these filters.") }
                }
            }
        }.task(id: request) { selected = nil; await comparison.load(request) }
            .task(id: comparisonTicketIDs) {
                for id in comparisonTicketIDs { guard !Task.isCancelled else { return }; await loadTitle(id) }
            }
    }
    private var comparisonTicketIDs: [Int] {
        guard let result = comparison.result else { return [] }
        return Array(Set((result.current.tasks + result.previous.tasks).compactMap(\.ticketID))).sorted()
    }
    private func periodSummary(_ title: String, _ data: ExplorerAnalysis, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline).foregroundStyle(color)
            Text(data.window.start.formatted(date: .abbreviated, time: .shortened) + " → " + data.window.end.formatted(date: .abbreviated, time: .shortened)).font(.callout)
            Text("\(data.count) entries · \(data.tasks.count) tasks · \(data.trackedDays) tracked days").font(.caption).foregroundStyle(Palette.secondary)
            if data.window.end > Date() { Text("Incomplete period · includes future target hours").font(.caption).foregroundStyle(Palette.warning) }
        }
    }
    private var columnHeadings: some View { HStack { Text("Activity / task"); Spacer(); Text("Selected").frame(width: 95); Text("Comparison").frame(width: 95); Text("Change").frame(width: 155) }.font(.caption).foregroundStyle(Palette.secondary) }
    private func deltaRow(_ row: ComparisonDelta) -> some View {
        HStack { Text(row.title).textSelection(.enabled); Spacer(); Text(DurationText.short(row.current)).frame(width: 95); Text(DurationText.short(row.previous)).frame(width: 95); Text(delta(row)).frame(width: 155) }.font(.callout).monospacedDigit().padding(.vertical, 5)
    }
    private func metric(_ title: String, a: Double, b: Double) -> some View {
        VStack(alignment: .leading, spacing: 5) { Text(title).font(.caption); Text(DurationText.short(a)).font(.title2).monospacedDigit(); Text(delta(ComparisonDelta(id: title, title: title, current: a, previous: b))).font(.caption).foregroundStyle(Palette.secondary) }
    }
    private func delta(_ row: ComparisonDelta) -> String {
        if abs(row.difference) < 1 { return "No change" }
        let time = (row.difference > 0 ? "+" : "−") + DurationText.short(abs(row.difference))
        return time + (row.percentage.map { " (" + String(format: "%+.0f", $0) + "%)" } ?? " (new)")
    }
    private func label(_ bucket: ExplorerBucket) -> String { bucket.start.formatted(date: .abbreviated, time: statistics.period == .day ? .shortened : .omitted) }
    private func detail(_ bucket: ExplorerBucket?) -> String { bucket.map { label($0) + " · " + DurationText.short($0.seconds) } ?? "Outside period" }
}

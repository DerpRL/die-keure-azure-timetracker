import SwiftUI
import Charts
import AzureTimetrackerCore

private enum ExplorerPage: String, CaseIterable { case time = "Time explorer", tasks = "Tasks", patterns = "Work patterns", comparisons = "Compare periods" }
private enum ExplorerGraph: String, CaseIterable {
    case activity = "Activity chart", heatmap = "Heatmaps", timeline = "Timeline", progress = "Progress"
    var title: String { switch self { case .activity: "Where your time went"; case .heatmap: "Your work at a glance"; case .timeline: "Your day’s task timeline"; case .progress: "Progress through the period" } }
}
private enum TaskOrder: String, CaseIterable { case time = "Most time", entries = "Most entries", recent = "Recently worked" }

struct StatisticsView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var statistics: StatisticsModel
    @ViewState private var page = ExplorerPage.time
    @ViewState private var graph = ExplorerGraph.activity
    @ViewState<String?> private var timelineEntry: String? = nil
    @ViewState private var taskOrder = TaskOrder.time
    @ViewState private var taskLimit = 20
    @ViewState private var entryLimit = 8
    @ViewState<Date?> private var selected: Date? = nil
    @ViewState private var customRange = false
    @ViewState private var customStart = Date()
    @ViewState private var customEnd = Date()
    private var range: StatisticsRange { statistics.range }
    private var data: ExplorerAnalysis? { statistics.loadedRange == range ? statistics.analysis : nil }
    private var rangeTitle: String { dateRange(statistics.bounds) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SectionTitle(title: "Statistics", subtitle: "See where your time went. Explore a period, narrow it down, then inspect the work behind it.")
                controls
                if let issue = statistics.issue {
                    Card {
                        HStack(alignment: .top) {
                            Label("Could not refresh worklogs", systemImage: "exclamationmark.triangle.fill").foregroundStyle(Palette.warning)
                            Text(issue).textSelection(.enabled)
                            Spacer()
                            Button("Retry") { Task { await statistics.load(force: true) } }.disabled(statistics.loading)
                        }.font(.callout)
                        if data != nil { Text("Showing the last downloaded worklogs.").font(.caption) }
                    }
                }
                if let data {
                    filters
                    if page != .comparisons { scopeHeader(data); metrics(data) }
                    Picker("Statistics section", selection: $page) {
                        ForEach(ExplorerPage.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }.pickerStyle(.segmented).labelsHidden().controlSize(.large)
                    Group {
                        switch page {
                        case .time: timeExplorer(data)
                        case .tasks: taskExplorer(data)
                        case .patterns: workPatterns(data)
                        case .comparisons:
                            ComparisonView(statistics: statistics, comparison: statistics.comparison, titles: model.workItems, inspectTask: { id in
                                statistics.filter.taskID = id; statistics.resetZoom(); page = .tasks
                            }, loadTitle: { await model.loadTicketTitle($0) })
                        }
                    }.disabled(statistics.analyzing).opacity(statistics.analyzing ? 0.55 : 1)
                    if page != .comparisons { sourceNotes(data) }
                } else if statistics.loading || statistics.analyzing {
                    Card { HStack(spacing: 12) { ProgressView().controlSize(.small); Text("Loading your recorded time…") }.frame(maxWidth: .infinity).padding(.vertical, 60) }
                } else if statistics.issue == nil {
                    Card { EmptyState(symbol: "chart.bar.xaxis", title: "Your statistics are waiting", detail: "Connect to 7pace in Settings to explore your recorded time.") }
                }
            }.padding(28)
        }
        .task(id: range) { selected = nil; entryLimit = 8; taskLimit = 20; await statistics.load() }
        .onChange(of: statistics.connectionID) { _, _ in Task { await statistics.load() } }
        .onChange(of: statistics.window) { _, _ in timelineEntry = nil; selected = nil; entryLimit = 8 }
        .onChange(of: statistics.filter) { _, _ in timelineEntry = nil; selected = nil; entryLimit = 8; taskLimit = 20 }
        .onChange(of: model.workItems) { _, items in statistics.updateTitles(items) }
        .task(id: statistics.syncedAt) {
            statistics.updateTitles(model.workItems)
            for id in statistics.ticketIDs {
                guard !Task.isCancelled else { return }
                await model.loadTicketTitle(id)
            }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Picker("Period", selection: $statistics.period) {
                    ForEach(StatisticsPeriod.allCases) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.segmented).labelsHidden().frame(width: 300)
                Button("Current " + statistics.period.rawValue.lowercased()) { statistics.current() }
                Spacer()
                Button { Task { await statistics.load(force: true) } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .disabled(statistics.loading || !statistics.configured)
            }
            HStack(spacing: 12) {
                Button { statistics.move(-1) } label: { Image(systemName: "chevron.left").frame(width: 20, height: 24) }.accessibilityLabel("Previous period")
                Text(rangeTitle).font(.system(size: 20, weight: .semibold, design: .rounded))
                Button { statistics.move(1) } label: { Image(systemName: "chevron.right").frame(width: 20, height: 24) }
                    .accessibilityLabel("Next period").disabled(range.end > Date())
                Spacer()
                DatePicker("Jump to", selection: $statistics.anchor, in: ...Date(), displayedComponents: .date).fixedSize()
            }
        }
    }
    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Palette.secondary)
                    TextField("Search ticket, title or comment", text: $statistics.filter.query).textFieldStyle(.plain)
                    if !statistics.filter.query.isEmpty { Button { statistics.filter.query = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).accessibilityLabel("Clear search") }
                }.padding(10).background(Palette.line.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
                Picker("Activity", selection: $statistics.filter.activityID) {
                    Text("All activities").tag(nil as String?)
                    ForEach(statistics.availableActivities) { Text($0.name).tag(Optional($0.id)) }
                    if let id = statistics.filter.activityID, !statistics.availableActivities.contains(where: { $0.id == id }) { Text("Selected activity (no entries)").tag(Optional(id)) }
                }.frame(maxWidth: 260)
                if statistics.filter.isActive { Button("Clear filters") { statistics.clearFilters() } }
            }
            HStack(spacing: 8) {
                if let task = statistics.filter.taskID {
                    filterChip("Task: " + (data?.tasks.first(where: { $0.id == task })?.title ?? "Selected task")) { statistics.filter.taskID = nil }
                }
                if let weekday = statistics.filter.weekday { filterChip(Calendar.current.weekdaySymbols[weekday - 1]) { statistics.filter.weekday = nil } }
                if let band = statistics.filter.lengthBand { filterChip("Entries: " + ExplorerRecord.bandNames[band]) { statistics.filter.lengthBand = nil } }
            }
        }
    }
    private func filterChip(_ title: String, clear: @escaping () -> Void) -> some View {
        Button(action: clear) { HStack(spacing: 6) { Text(title).lineLimit(1); Image(systemName: "xmark") }.font(.caption.weight(.medium)) }
            .help("Remove filter: " + title).accessibilityLabel("Remove filter: " + title)
    }
    private func scopeHeader(_ data: ExplorerAnalysis) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(statistics.isZoomed ? "Selected window · " + dateRange(statistics.window, includeTime: true) : "Whole " + statistics.period.rawValue.lowercased())
                    .font(.headline)
                Text(statistics.filter.isActive ? "All totals and charts below use your active filters." : "All activities and tasks · recorded time only")
                    .font(.caption).foregroundStyle(Palette.secondary)
            }
            Spacer()
            if statistics.analyzing { ProgressView().controlSize(.small); Text("Updating…").font(.caption) }
            if statistics.isZoomed { Button("Reset zoom") { statistics.resetZoom() } }
        }
    }
    private func metrics(_ data: ExplorerAnalysis) -> some View {
        HStack(spacing: 12) {
            metric("Recorded time", DurationText.short(data.total), "\(data.count) entries · \(data.trackedDays) tracked days", icon: "clock")
            metric("Tasks worked on", String(data.tasks.count), "Tickets and work without a ticket", icon: "checklist")
            metric("Typical entry", DurationText.short(data.median), "Median duration inside this window", icon: "timer")
            if !statistics.isZoomed && !statistics.filter.isActive {
                metric("Period target", data.target > 0 ? (data.total / data.target).formatted(.percent.precision(.fractionLength(0))) : "Not set", "of " + DurationText.short(data.target) + " scheduled", icon: "target")
            } else {
                metric("Average tracked day", DurationText.short(data.trackedDays > 0 ? data.total / Double(data.trackedDays) : 0), "Across days with matching entries", icon: "calendar")
            }
        }
    }
    private func metric(_ title: String, _ value: String, _ note: String, icon: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                Label(title, systemImage: icon).font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary)
                Text(value).font(.system(size: 25, weight: .bold, design: .rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                Text(note).font(.caption).foregroundStyle(Palette.secondary).frame(height: 32, alignment: .topLeading)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func timeExplorer(_ data: ExplorerAnalysis) -> some View {
        VStack(spacing: 18) {
            Card {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(graph.title).font(.headline)
                            if graph == .activity { Text("Click a bar to inspect it. Drag across the chart to zoom into a range.").font(.callout).foregroundStyle(Palette.secondary) }
                        }
                        Spacer()
                        Text(data.resolution.rawValue).font(.caption.weight(.semibold)).padding(7).background(Palette.line.opacity(0.5), in: Capsule())
                    }
                    Picker("Chart type", selection: $graph) {
                        ForEach(ExplorerGraph.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }.pickerStyle(.segmented).labelsHidden().controlSize(.large)
                    zoomControls
                    if graph == .activity {
                    ExplorerTimeChart(data: data, selected: $selected, colors: colors, zoom: { statistics.zoom(to: $0) })
                        .frame(height: 270)
                    HStack {
                        Picker("Inspect interval", selection: $selected) {
                            Text("Choose a bar…").tag(nil as Date?)
                            ForEach(data.buckets) { Text(bucketLabel($0) + " · " + DurationText.short($0.seconds)).tag(Optional($0.start)) }
                        }.frame(maxWidth: 430)
                        if let bucket = chosenBucket(data) {
                            Button("Zoom into selection") { statistics.zoom(to: bucket.interval) }
                                .disabled(bucket.interval.duration <= StatisticsZoom.minimum && statistics.window.duration <= StatisticsZoom.minimum)
                            Button("Clear") { selected = nil }
                        }
                        Spacer(minLength: 0)
                    }.controlSize(.regular)
                    activityLegend(data)
                    } else if let visuals = statistics.visuals {
                        switch graph {
                        case .heatmap:
                            ExplorerHeatmapView(visuals: visuals, showTargets: showChartTargets, openDay: openTimeline, openHour: openTimeline)
                        case .timeline:
                            ExplorerTimelineView(data: data, visuals: visuals, colors: colors, selectedEntry: $timelineEntry, zoom: { statistics.zoom(to: $0) })
                            activityLegend(data)
                        case .progress:
                            ExplorerProgressChart(data: data, visuals: visuals, showTargets: showChartTargets)
                        case .activity: EmptyView()
                        }
                    }
                }
            }
            if graph == .timeline, let entry = data.entries.first(where: { $0.id == timelineEntry }) {
                entryList([entry], title: "Selected timeline entry", detail: "Recorded task, activity and times inside the selected window.")
            } else if graph == .activity, let bucket = chosenBucket(data) { selectionInspector(data, bucket: bucket) }
            ExplorerActivityDonut(data: data, colors: colors, select: toggleActivity)
            if (graph != .activity || chosenBucket(data) == nil) && (graph != .timeline || timelineEntry == nil) {
                entryList(data.entries, title: "Entries in this window", detail: "Select a chart bar or timeline entry to inspect its recorded time.")
            }
        }
    }
    private var showChartTargets: Bool { !statistics.isZoomed && !statistics.filter.isActive && (data?.target ?? 0) > 0 }
    private func openTimeline(_ interval: DateInterval) { statistics.zoom(to: interval); graph = .timeline; timelineEntry = nil }
    private var zoomControls: some View {
        HStack(spacing: 8) {
            Button { statistics.back() } label: { Label("Back", systemImage: "arrow.uturn.backward") }.disabled(statistics.zoomHistory.isEmpty)
            Button { statistics.scale(0.5) } label: { Label("Zoom in", systemImage: "plus.magnifyingglass") }.disabled(statistics.window.duration <= StatisticsZoom.minimum)
            Button { statistics.scale(2) } label: { Label("Zoom out", systemImage: "minus.magnifyingglass") }.disabled(!statistics.isZoomed)
            Button { statistics.pan(-1) } label: { Image(systemName: "arrow.left") }.accessibilityLabel("Pan earlier").help("Pan earlier")
                .disabled(statistics.window.start <= statistics.bounds.start)
            Button { statistics.pan(1) } label: { Image(systemName: "arrow.right") }.accessibilityLabel("Pan later").help("Pan later")
                .disabled(statistics.window.end >= statistics.bounds.end)
            Spacer()
            Button("Choose range…") { customStart = statistics.window.start; customEnd = statistics.window.end; customRange = true }
                .popover(isPresented: $customRange) {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Zoom to a time range").font(.headline)
                        DatePicker("From", selection: $customStart, in: statistics.bounds.start...statistics.bounds.end)
                        DatePicker("To", selection: $customEnd, in: statistics.bounds.start...statistics.bounds.end)
                        Text("Minimum window: 15 minutes. Ranges stay inside the selected period.").font(.caption).foregroundStyle(Palette.secondary)
                        HStack { Button("Cancel") { customRange = false }; Spacer(); Button("Apply range") { statistics.zoom(to: DateInterval(start: customStart, end: customEnd)); customRange = false }.disabled(customEnd <= customStart) }
                    }.padding(22).frame(width: 420)
                }
        }.controlSize(.regular)
    }
    private var colors: [String: Color] {
        let palette: [Color] = [Palette.accent, .blue, .orange, .purple, .pink, .indigo, .brown, .gray]
        return Dictionary(uniqueKeysWithValues: statistics.availableActivities.sorted { $0.id < $1.id }.enumerated().map { ($0.element.id, palette[$0.offset % palette.count]) })
    }
    private func activityLegend(_ data: ExplorerAnalysis) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), alignment: .leading)], alignment: .leading, spacing: 8) {
            ForEach(data.activities) { activity in
                Button { toggleActivity(activity.id) } label: {
                    HStack(spacing: 6) { Circle().fill(colors[activity.id] ?? Palette.accent).frame(width: 8, height: 8); Text(activity.name).lineLimit(1); Text(DurationText.short(activity.seconds)).foregroundStyle(Palette.secondary) }.font(.caption)
                }.buttonStyle(.plain).help("Filter by " + activity.name).accessibilityLabel("Filter by " + activity.name + ", " + DurationText.short(activity.seconds))
            }
        }
    }
    private func chosenBucket(_ data: ExplorerAnalysis) -> ExplorerBucket? { data.buckets.first { $0.start == selected } }
    private func selectionInspector(_ data: ExplorerAnalysis, bucket: ExplorerBucket) -> some View {
        let entries = data.entries.filter { $0.start < bucket.end && $0.end > bucket.start }
        return entryList(entries, title: bucketLabel(bucket) + " · " + DurationText.short(bucket.seconds), detail: "Matching entries below show only their time inside this interval.", clip: bucket.interval)
    }
    private func entryList(_ entries: [ExplorerEntry], title: String, detail: String, clip: DateInterval? = nil) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                HStack { Text(title).font(.headline); Spacer(); Text("\(entries.count) segments").font(.caption).foregroundStyle(Palette.secondary) }
                Text(detail).font(.caption).foregroundStyle(Palette.secondary)
                if entries.isEmpty { Text("No matching entries. Try a different interval or clear your filters.").foregroundStyle(Palette.secondary).padding(.vertical, 15) }
                ForEach(Array(entries.prefix(entryLimit))) { entry in
                    entryRow(entry, clip: clip)
                    if entry.id != entries.prefix(entryLimit).last?.id { Divider() }
                }
                if entries.count > entryLimit { Button("Show 20 more entries (\(entries.count - entryLimit) remaining)") { entryLimit += 20 } }
            }
        }
    }
    private func entryRow(_ entry: ExplorerEntry, clip: DateInterval?) -> some View {
        let start = max(entry.start, clip?.start ?? entry.start), end = min(entry.end, clip?.end ?? entry.end)
        let record = entry.record
        return HStack(alignment: .top, spacing: 14) {
            RoundedRectangle(cornerRadius: 2).fill(colors[record.activityID] ?? Palette.accent).frame(width: 4, height: 45)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    if let id = record.ticketID { Text("#" + String(id)).foregroundStyle(Palette.accent) }
                    Text(record.ticketID.flatMap { model.workItems[$0]?.title } ?? record.fallbackTitle).fontWeight(.semibold).lineLimit(2)
                }
                Text(start.formatted(.dateTime.day().month(.abbreviated).hour().minute()) + " – " + end.formatted(.dateTime.hour().minute()) + " · " + record.activityName).font(.caption).foregroundStyle(Palette.secondary)
                if let comment = record.log.comment, !comment.isEmpty { Text(comment).font(.caption).lineLimit(2).textSelection(.enabled) }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                Text(DurationText.short(end.timeIntervalSince(start))).font(.callout.weight(.semibold)).monospacedDigit()
                if start != record.start || end != record.end { Text("in selection").font(.caption2).foregroundStyle(Palette.secondary) }
            }.frame(minWidth: 70, alignment: .trailing)
            if let id = record.ticketID { Button { model.showContext(id) } label: { Image(systemName: "sidebar.right") }.help("Open ticket context").accessibilityLabel("Open context for ticket " + String(id)) }
            Button { model.timeEditor.day = record.start; model.timeEditor.filter = record.ticketID.map(String.init) ?? record.log.comment ?? ""; model.page = .timeEditor } label: { Image(systemName: "square.and.pencil") }
                .help("Open original entry's day in Time editor").accessibilityLabel("Edit entries for " + record.fallbackTitle)
        }.controlSize(.regular)
    }

    private func taskExplorer(_ data: ExplorerAnalysis) -> some View {
        VStack(spacing: 18) {
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        VStack(alignment: .leading, spacing: 5) { Text("Tasks you worked on").font(.headline); Text("Select a task to explore its timeline and entries.").font(.callout).foregroundStyle(Palette.secondary) }
                        Spacer(); Picker("Sort", selection: $taskOrder) { ForEach(TaskOrder.allCases, id: \.self) { Text($0.rawValue).tag($0) } }.frame(width: 210)
                    }
                    HStack { Text("TASK / SHARE OF SELECTED TIME").frame(maxWidth: .infinity, alignment: .leading); Text("TIME").frame(width: 85, alignment: .trailing); Text("ENTRIES").frame(width: 60, alignment: .trailing); Text("DAYS").frame(width: 40, alignment: .trailing); Text("AVG / ENTRY").frame(width: 95, alignment: .trailing) }
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.secondary).padding(.horizontal, 10)
                    Divider()
                    if data.tasks.isEmpty { Text("No tasks match these filters.").foregroundStyle(Palette.secondary).padding() }
                    ForEach(Array(orderedTasks(data).prefix(taskLimit))) { task in
                        taskRow(task, total: data.total)
                    }
                    if data.tasks.count > taskLimit { Button("Show 20 more tasks") { taskLimit += 20 } }
                    Text("Work without an Azure ticket is grouped by activity and comment. Entry averages use only the selected time window.").font(.caption).foregroundStyle(Palette.secondary)
                }
            }
            activityBreakdown(data)
        }
    }
    private func taskRow(_ task: ExplorerTask, total: Double) -> some View {
        let share: Double = task.seconds / max(1, total)
        let percentage = share.formatted(.percent.precision(.fractionLength(0)))
        return Button {
            statistics.filter.taskID = task.id; page = .time
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text((task.ticketID.map { "#" + String($0) + " · " } ?? "") + task.title).font(.callout.weight(.semibold)).lineLimit(2)
                    HStack { ExplorerShareBar(value: share); Text(percentage).font(.caption).foregroundStyle(Palette.secondary).frame(width: 36, alignment: .trailing) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                Text(DurationText.short(task.seconds)).frame(width: 85, alignment: .trailing)
                Text(String(task.count)).frame(width: 60, alignment: .trailing)
                Text(String(task.days)).frame(width: 40, alignment: .trailing)
                Text(DurationText.short(task.seconds / Double(task.count))).frame(width: 95, alignment: .trailing)
            }.monospacedDigit().padding(10).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityElement(children: .ignore).accessibilityAddTraits(.isButton).background(Palette.line.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            .help("Explore " + task.title).accessibilityLabel("Explore " + task.title + ", " + DurationText.short(task.seconds) + ", \(task.count) entries")
    }
    private func orderedTasks(_ data: ExplorerAnalysis) -> [ExplorerTask] {
        switch taskOrder {
        case .time: data.tasks
        case .entries: data.tasks.sorted { $0.count == $1.count ? $0.id < $1.id : $0.count > $1.count }
        case .recent: data.tasks.sorted { $0.lastWorked == $1.lastWorked ? $0.id < $1.id : $0.lastWorked > $1.lastWorked }
        }
    }
    private func activityBreakdown(_ data: ExplorerAnalysis) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                Text("Time by activity").font(.headline)
                Text("Select an activity to filter every chart and task in this period.").font(.callout).foregroundStyle(Palette.secondary)
                ForEach(data.activities) { activity in
                    Button { toggleActivity(activity.id) } label: {
                        HStack(spacing: 14) {
                            Text(activity.name).frame(width: 140, alignment: .leading).lineLimit(2)
                            GeometryReader { geo in RoundedRectangle(cornerRadius: 4).fill(Palette.line.opacity(0.5)); RoundedRectangle(cornerRadius: 4).fill(colors[activity.id] ?? Palette.accent).frame(width: max(3, geo.size.width * activity.seconds / max(1, data.total))) }.frame(height: 16)
                            Text(DurationText.short(activity.seconds)).monospacedDigit().frame(width: 95, alignment: .trailing)
                            Text((activity.seconds / max(1, data.total)).formatted(.percent.precision(.fractionLength(0)))).foregroundStyle(Palette.secondary).frame(width: 40, alignment: .trailing)
                            Image(systemName: statistics.filter.activityID == activity.id ? "checkmark.circle.fill" : "line.3.horizontal.decrease.circle").foregroundStyle(Palette.accent)
                        }.padding(.vertical, 7).contentShape(Rectangle())
                    }.buttonStyle(.plain).help("Filter by " + activity.name)
                }
                if data.activities.isEmpty { Text("No activities in this selection.").foregroundStyle(Palette.secondary) }
            }
        }
    }
    private func toggleActivity(_ id: String) { statistics.filter.activityID = statistics.filter.activityID == id ? nil : id }

    private func workPatterns(_ data: ExplorerAnalysis) -> some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                metric("Context switches", String(data.context.switches), "Between tasks, with breaks up to 15 min", icon: "arrow.triangle.branch")
                metric("Longest work block", DurationText.short(data.context.longestBlock), "Continuous entries for the same task", icon: "rectangle.split.1x2")
                metric("Overlapping time", DurationText.short(data.overlap), "Recorded total minus covered clock time", icon: "square.on.square")
            }
            HStack(alignment: .top, spacing: 18) {
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Time by weekday").font(.headline)
                        Text("Total recorded time. Select a day to filter.").font(.caption).foregroundStyle(Palette.secondary)
                        ForEach(data.weekdays) { item in patternRow(item, maxValue: data.weekdays.map(\.seconds).max() ?? 1, selected: statistics.filter.weekday == item.id) { statistics.filter.weekday = statistics.filter.weekday == item.id ? nil : item.id } }
                    }
                }
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Entry lengths").font(.headline)
                        Text("Original entry duration. Select a band to filter.").font(.caption).foregroundStyle(Palette.secondary)
                        ForEach(data.lengths) { item in patternRow(item, maxValue: data.lengths.map(\.seconds).max() ?? 1, selected: statistics.filter.lengthBand == item.id, showCount: true) { statistics.filter.lengthBand = statistics.filter.lengthBand == item.id ? nil : item.id } }
                        Text("Long entries are not a measure of concentration. Filters keep the original duration band when you zoom.").font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    Text("When you record work").font(.headline)
                    Text("Hours by time of day, summed across this selection in your Mac’s time zone.").font(.callout).foregroundStyle(Palette.secondary)
                    Chart(data.hours) { hour in
                        BarMark(x: .value("Hour", hour.id), y: .value("Recorded hours", hour.seconds / 3600)).foregroundStyle(Palette.accent).cornerRadius(3)
                            .accessibilityLabel(hour.label).accessibilityValue(DurationText.short(hour.seconds))
                    }.chartXScale(domain: -1...24).chartXAxis { AxisMarks(values: [0, 4, 8, 12, 16, 20, 23]) { value in AxisValueLabel { if let hour = value.as(Int.self) { Text(String(format: "%02d:00", hour)) } } } }
                        .chartYAxisLabel("Recorded hours").frame(height: 200)
                    if let peak = data.hours.max(by: { $0.seconds < $1.seconds }), peak.seconds > 0 {
                        Text("Most recorded hour: " + peak.label + " · " + DurationText.short(peak.seconds) + " across the selection.").font(.caption.weight(.medium))
                    }
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Reading these patterns").font(.headline)
                    Text("\(DurationText.short(data.covered)) of clock time is covered by matching entries. Overlapping entries remain in recorded totals, but are excluded from context-switch and continuous-block calculations.")
                    Text("Billable time: " + (data.billableKnownCount > 0 ? DurationText.short(data.billable) + " · supplied by 7pace for \(data.billableKnownCount) of \(data.count) entries." : "Not supplied by 7pace for these entries."))
                    Text("Switches and blocks describe recorded entries, not attention or productivity. Applying filters can hide intervening tasks; clear filters for the complete sequence.")
                }.font(.callout).foregroundStyle(Palette.secondary)
            }
            entryList(data.entries, title: "Entries behind these patterns", detail: "Open an entry’s day to review or correct it in Time editor.")
        }
    }
    private func patternRow(_ item: ExplorerPattern, maxValue: Double, selected: Bool, showCount: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack { Text(item.label); Spacer(); if showCount { Text("\(item.count) entries ·").foregroundStyle(Palette.secondary) }; Text(DurationText.short(item.seconds)).monospacedDigit(); Image(systemName: selected ? "checkmark.circle.fill" : "line.3.horizontal.decrease.circle").foregroundStyle(Palette.accent) }.font(.caption)
                ExplorerShareBar(value: item.seconds / max(1, maxValue))
            }.padding(.vertical, 4).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityElement(children: .ignore).accessibilityAddTraits(.isButton).help("Filter by " + item.label).accessibilityLabel("Filter by " + item.label + ", " + DurationText.short(item.seconds))
    }
    private func sourceNotes(_ data: ExplorerAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            if let sync = statistics.syncedAt { Label("Synced " + sync.formatted(date: .abbreviated, time: .shortened), systemImage: "arrow.clockwise").fontWeight(.medium) }
            Text("7pace worklogs only; the live timer is not added. Entries are clipped to your selected window and split at midnight. Weeks start on Monday. Refresh after editing time.")
            Text("One preceding day is downloaded to include overnight work. Entries that started earlier are not included. Targets use your current daily schedule; holidays and leave are not deducted.")
            if statistics.omitted > 0 { Text("\(statistics.omitted) entries were omitted because their date or duration is invalid.").foregroundStyle(Palette.warning) }
        }.font(.caption).foregroundStyle(Palette.secondary)
    }
    private func bucketLabel(_ bucket: ExplorerBucket) -> String { dateRange(bucket.interval, includeTime: bucket.interval.duration < 36 * 3600 && data?.resolution != .day) }
    private func dateRange(_ interval: DateInterval, includeTime: Bool = false) -> String {
        if includeTime {
            return interval.start.formatted(.dateTime.day().month(.abbreviated).hour().minute()) + " – " + interval.end.formatted(.dateTime.day().month(.abbreviated).hour().minute())
        }
        if interval.duration > 300 * 86400 { return interval.start.formatted(.dateTime.year()) }
        let end = interval.end.addingTimeInterval(-1)
        if Calendar.current.isDate(interval.start, inSameDayAs: end) { return interval.start.formatted(.dateTime.weekday(.wide).day().month(.wide).year()) }
        return interval.start.formatted(.dateTime.day().month(.abbreviated)) + " – " + end.formatted(.dateTime.day().month(.abbreviated).year())
    }
}

/// Decorative bars inside buttons must not replace the button's accessibility role.
private struct ExplorerShareBar: View {
    let value: Double
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.line.opacity(0.6))
                Capsule().fill(Palette.accent).frame(width: geometry.size.width * min(1, max(0, value)))
            }
        }.frame(height: 7).accessibilityHidden(true)
    }
}

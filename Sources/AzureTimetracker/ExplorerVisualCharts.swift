import SwiftUI
import Charts
import AzureTimetrackerCore

struct ExplorerHeatmapView: View {
    @Environment(\.interfacePalette) private var palette

    let visuals: ExplorerVisuals
    let showTargets: Bool
    let openDay: (DateInterval) -> Void
    let openHour: (DateInterval) -> Void
    private let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    private var maximum: Double { max(3600, visuals.days.map(\.seconds).max() ?? 0) }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if visuals.days.count > 1 {
                Text("Calendar heatmap").font(.headline)
                Text("Each cell is a day. Select one to open its task timeline. Empty days remain visible.").font(.callout).foregroundStyle(palette.secondary)
                if visuals.days.count > 62 { annualGrid } else { calendarGrid }
                legend(maximum, unit: "per day")
            }
            if !visuals.hours.isEmpty {
                Text("Hourly heatmap").font(.headline)
                Text("Select an hour to zoom into its timeline. Repeated daylight-saving hours have separate cells.").font(.callout).foregroundStyle(palette.secondary)
                hourGrid
                legend(max(3600, visuals.hours.map(\.seconds).max() ?? 0), unit: "per cell")
            }
        }
    }
    private var annualGrid: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(spacing: 3) { Color.clear.frame(height: 20); ForEach(weekdays, id: \.self) { Text($0).font(.caption2).foregroundStyle(palette.secondary).frame(height: 16) } }.frame(width: 28)
            GeometryReader { geo in
                let width = max(9, (geo.size.width - CGFloat(visuals.weekCount - 1) * 3) / CGFloat(visuals.weekCount))
                HStack(alignment: .top, spacing: 3) {
                    ForEach(0..<visuals.weekCount, id: \.self) { week in
                        let days = visuals.days.filter { $0.week == week }
                        VStack(spacing: 3) {
                            ZStack(alignment: .leading) {
                                Color.clear.frame(width: width, height: 20)
                                if let month = days.first(where: { Calendar.current.component(.day, from: $0.date) <= 7 && $0.weekday == 0 }) {
                                    Text(month.date.formatted(.dateTime.month(.abbreviated))).font(.caption2).foregroundStyle(palette.secondary).fixedSize()
                                }
                            }
                            ForEach(0..<7, id: \.self) { weekday in
                                if let day = days.first(where: { $0.weekday == weekday }) { dayButton(day, compact: true).frame(width: width, height: 16) }
                                else { Color.clear.frame(width: width, height: 16) }
                            }
                        }
                    }
                }
            }.frame(height: 155)
        }
    }
    private var calendarGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 6) {
            ForEach(weekdays, id: \.self) { Text($0).font(.caption).foregroundStyle(palette.secondary) }
            ForEach(0..<(visuals.days.first?.weekday ?? 0), id: \.self) { _ in Color.clear.frame(height: 50) }
            ForEach(visuals.days) { day in dayButton(day, compact: false).frame(height: 50) }
        }
    }
    private func dayButton(_ day: ExplorerCalendarDay, compact: Bool) -> some View {
        let title = day.date.formatted(date: .complete, time: .omitted)
        let value = DurationText.short(day.seconds) + " · \(day.entries) entries" + (showTargets ? " · target " + DurationText.short(day.target) : "")
        return Button { openDay(day.interval) } label: {
            ZStack {
                RoundedRectangle(cornerRadius: compact ? 2 : 7).fill(heatColor(day.seconds, max: maximum))
                RoundedRectangle(cornerRadius: compact ? 2 : 7).stroke(palette.secondary.opacity(day.future ? 0.4 : 0.15), style: StrokeStyle(lineWidth: 1, dash: day.future ? [2, 2] : []))
                if !compact {
                    VStack(spacing: 3) {
                        Text(day.date.formatted(.dateTime.day().month(.abbreviated))).font(.caption.weight(.semibold))
                        Text(day.future && day.seconds == 0 ? "Future" : DurationText.short(day.seconds)).font(.caption2)
                    }.foregroundStyle(day.seconds > maximum * 0.35 ? Color.black : Color.primary)
                }
            }.contentShape(Rectangle())
        }.buttonStyle(.plain).help(title + " · " + value)
            .accessibilityLabel("Open timeline for " + title).accessibilityValue(value)
    }
    private var hourGrid: some View {
        let maxSeconds = max(3600, visuals.hours.map(\.seconds).max() ?? 0)
        let columns = (visuals.hours.map(\.slot).max() ?? 0) + 1
        return VStack(spacing: 6) {
            ForEach(visuals.days) { day in
                let hours = visuals.hours.filter { $0.day == day.date }
                HStack(spacing: 4) {
                    Text(day.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))).font(.caption2).frame(width: 75, alignment: .leading)
                    ForEach(0..<columns, id: \.self) { slot in
                        if let hour = hours.first(where: { $0.slot == slot }) {
                            Button { openHour(hour.interval) } label: {
                                VStack(spacing: 3) {
                                    Text(slot % 3 == 0 || slot == hours.first?.slot ? hour.interval.start.formatted(.dateTime.hour(.twoDigits(amPM: .omitted))) : " ")
                                        .font(.system(size: 9)).foregroundStyle(palette.secondary)
                                    RoundedRectangle(cornerRadius: 3).fill(heatColor(hour.seconds, max: maxSeconds)).frame(height: 24)
                                }.frame(maxWidth: .infinity)
                            }.buttonStyle(.plain)
                                .help(hour.interval.start.formatted(.dateTime.day().month().hour().minute().timeZone()) + " · " + DurationText.short(hour.seconds))
                                .accessibilityLabel("Open hour " + hour.interval.start.formatted(.dateTime.day().month().hour().minute().timeZone()))
                                .accessibilityValue(DurationText.short(hour.seconds))
                        } else { Color.clear.frame(maxWidth: .infinity).frame(height: 39) }
                    }
                }
            }
        }
    }
    private func heatColor(_ seconds: Double, max maximum: Double) -> Color {
        seconds == 0 ? palette.line.opacity(0.65) : palette.accent.opacity(0.22 + 0.78 * min(1, seconds / maximum))
    }
    private func legend(_ maximum: Double, unit: String) -> some View {
        HStack(spacing: 7) {
            Text("0h")
            ForEach(0..<5, id: \.self) { step in RoundedRectangle(cornerRadius: 2).fill(heatColor(maximum * Double(step) / 4, max: maximum)).frame(width: 18, height: 12) }
            Text(DurationText.short(maximum) + " " + unit)
            Spacer()
            if visuals.days.contains(where: \.future) { Text("Dashed outline: future date") }
        }.font(.caption).foregroundStyle(palette.secondary)
    }
}

struct ExplorerTimelineView: View {
    @Environment(\.interfacePalette) private var palette

    let data: ExplorerAnalysis
    let visuals: ExplorerVisuals
    let colors: [String: Color]
    @Binding var selectedEntry: String?
    let zoom: (DateInterval) -> Void
    @ViewState<Date?> private var chosenDay: Date? = nil
    @ViewState private var page = 0
    private var day: ExplorerCalendarDay? {
        visuals.days.first(where: { $0.date == chosenDay }) ?? visuals.days.last(where: { $0.seconds > 0 }) ?? visuals.days.first
    }
    private var entries: [ExplorerEntry] {
        guard let day else { return [] }; return data.entries.filter { $0.start < day.interval.end && $0.end > day.interval.start }
    }
    private var pageEntries: [ExplorerEntry] { Array(entries.dropFirst(min(page, max(0, (entries.count - 1) / 12)) * 12).prefix(12)) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Picker("Timeline day", selection: Binding(get: { day?.date }, set: { chosenDay = $0; page = 0; selectedEntry = nil })) {
                    ForEach(visuals.days) { day in Text(day.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)) + " · " + DurationText.short(day.seconds)).tag(Optional(day.date)) }
                }.frame(maxWidth: 360)
                Spacer()
                if let day, day.interval != data.window { Button("Zoom to this day") { zoom(day.interval) } }
            }
            Text("Each row is one recorded entry. Gaps and overlapping times stay visible. Select a bar for its entry details below.")
                .font(.callout).foregroundStyle(palette.secondary)
            if let day, !pageEntries.isEmpty {
                Chart(pageEntries) { entry in
                    BarMark(xStart: .value("Start", entry.start), xEnd: .value("End", entry.end), y: .value("Entry", entry.id), height: .ratio(0.6))
                        .foregroundStyle(colors[entry.record.activityID] ?? palette.accent).cornerRadius(4)
                        .opacity(selectedEntry == nil || selectedEntry == entry.id ? 1 : 0.35)
                        .accessibilityLabel(title(entry) + " · " + entry.record.activityName)
                        .accessibilityValue(entry.start.formatted(.dateTime.hour().minute().timeZone()) + " to " + entry.end.formatted(.dateTime.hour().minute().timeZone()) + " · " + DurationText.short(entry.seconds))
                }
                .chartXScale(domain: day.interval.start...day.interval.end)
                .chartYScale(domain: pageEntries.map(\.id))
                .chartYAxis { AxisMarks(position: .leading) { value in AxisValueLabel { if let id = value.as(String.self), let entry = pageEntries.first(where: { $0.id == id }) { Text(title(entry)).lineLimit(1).frame(width: 165, alignment: .trailing) } } } }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) { value in AxisGridLine(); AxisTick(); AxisValueLabel { if let date = value.as(Date.self) { Text(date.formatted(.dateTime.hour().minute())) } } } }
                .frame(height: CGFloat(max(170, pageEntries.count * 34)))
                .chartOverlay { proxy in
                    GeometryReader { geometry in
                        Rectangle().fill(.clear).contentShape(Rectangle())
                            .onTapGesture { point in
                                guard let frame = proxy.plotFrame else { return }
                                let plot = geometry[frame]
                                guard plot.contains(point), let id: String = proxy.value(atY: point.y - plot.minY) else { return }
                                selectedEntry = id
                            }.accessibilityHidden(true)
                    }
                }
                HStack {
                    Picker("Inspect entry", selection: $selectedEntry) {
                        Text("Choose an entry…").tag(nil as String?)
                        ForEach(entries) { entry in Text(entry.start.formatted(.dateTime.hour().minute()) + " · " + title(entry) + " · " + DurationText.short(entry.seconds)).tag(Optional(entry.id)) }
                    }.frame(maxWidth: 430)
                    if let entry = entries.first(where: { $0.id == selectedEntry }) {
                        Button("Zoom to entry") { zoom(DateInterval(start: entry.start, end: entry.end)) }
                        Button("Clear") { selectedEntry = nil }
                    }
                    Spacer(minLength: 0)
                }
                if entries.count > 12 {
                    HStack {
                        Button("Previous entries") { page -= 1; selectedEntry = nil }.disabled(page == 0)
                        Text("\(page * 12 + 1)–\(min(entries.count, (page + 1) * 12)) of \(entries.count) entries").font(.caption)
                        Button("Next entries") { page += 1; selectedEntry = nil }.disabled((page + 1) * 12 >= entries.count)
                    }
                }
            } else { EmptyState(symbol: "chart.bar.xaxis", title: "No entries in this day", detail: "Choose another day or adjust the active filters.").padding(.vertical, 25) }
        }
        .onChange(of: data.window) { _, _ in chosenDay = nil; page = 0; selectedEntry = nil }
        .onChange(of: data.entries.map(\.id)) { _, _ in page = 0; selectedEntry = nil }
    }
    private func title(_ entry: ExplorerEntry) -> String {
        let title = data.tasks.first { $0.id == entry.record.taskID }?.title ?? entry.record.fallbackTitle
        return (entry.record.ticketID.map { "#" + String($0) + " · " } ?? "") + title
    }
}

struct ExplorerProgressChart: View {
    @Environment(\.interfacePalette) private var palette

    let data: ExplorerAnalysis
    let visuals: ExplorerVisuals
    let showTargets: Bool
    @ViewState<Date?> private var selectedDate: Date? = nil
    private var inspected: ExplorerProgressPoint? {
        guard let selectedDate else { return nil }; return visuals.progress.min { abs($0.date.timeIntervalSince(selectedDate)) < abs($1.date.timeIntervalSince(selectedDate)) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(showTargets ? "Recorded time alongside your scheduled target. Future dates show the target without projecting tracked time." : "Cumulative recorded time inside this filtered or zoomed window. Clear filters and reset zoom to compare the complete period with its target.")
                .font(.callout).foregroundStyle(palette.secondary)
            HStack {
                Label("Recorded", systemImage: "minus").foregroundStyle(palette.accent)
                if showTargets { Label("Scheduled target", systemImage: "ellipsis").foregroundStyle(palette.warning) }
                Spacer()
                if let inspected { Text(inspected.date.formatted(.dateTime.day().month(.abbreviated).hour().minute()) + " · " + DurationText.short(inspected.seconds)).monospacedDigit() }
            }.font(.caption).frame(height: 20)
            Chart {
                ForEach(visuals.progress) { point in
                    AreaMark(x: .value("Date", point.date), y: .value("Hours", point.seconds / 3600)).foregroundStyle(palette.accent.opacity(0.12)).interpolationMethod(.stepEnd)
                    LineMark(x: .value("Date", point.date), y: .value("Hours", point.seconds / 3600), series: .value("Series", "Recorded"))
                        .foregroundStyle(palette.accent).lineStyle(StrokeStyle(lineWidth: 2.5)).interpolationMethod(.stepEnd)
                        .accessibilityLabel(point.date.formatted(date: .abbreviated, time: .shortened)).accessibilityValue(DurationText.short(point.seconds))
                }
                if showTargets {
                    ForEach(visuals.targetProgress) { point in
                        LineMark(x: .value("Date", point.date), y: .value("Hours", point.target / 3600), series: .value("Series", "Target"))
                            .foregroundStyle(palette.warning).lineStyle(StrokeStyle(lineWidth: 1.5, dash: [5, 4])).interpolationMethod(.stepEnd)
                            .accessibilityLabel("Target through " + point.date.formatted(date: .abbreviated, time: .omitted)).accessibilityValue(DurationText.short(point.target))
                    }
                }
                if let inspected { RuleMark(x: .value("Selected date", inspected.date)).foregroundStyle(palette.secondary).lineStyle(StrokeStyle(dash: [3, 3])) }
            }.chartXScale(domain: data.window.start...data.window.end).chartYAxisLabel("Cumulative hours").chartLegend(.hidden)
                .chartYScale(domain: 0...max(1, max(data.total, showTargets ? data.target : 0) / 3600 * 1.05))
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) { value in AxisValueLabel { if let date = value.as(Date.self) {
                    if data.window.duration <= 36 * 3600 { Text(date.formatted(.dateTime.hour().minute())) }
                    else { Text(date.formatted(.dateTime.day().month(.abbreviated))) }
                } } } }
                .chartXSelection(value: $selectedDate).frame(height: 250)
            DisclosureGroup("Exact cumulative values") {
                ForEach(visuals.progress) { point in
                    HStack { Text(point.date.formatted(date: .abbreviated, time: .shortened)); Spacer(); Text(DurationText.short(point.seconds)).monospacedDigit() }.font(.caption)
                }
            }.font(.caption)
        }.onChange(of: data.window) { _, _ in selectedDate = nil }
    }
}

struct ExplorerActivityDonut: View {
    @Environment(\.interfacePalette) private var palette

    let data: ExplorerAnalysis
    let colors: [String: Color]
    let select: (String) -> Void
    @ViewState<Double?> private var angle: Double? = nil
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                Text("Activity mix").font(.headline)
                Text("Select a slice or activity to filter your charts and entries.").font(.callout).foregroundStyle(palette.secondary)
                if data.total == 0 { Text("No recorded time in this selection.").foregroundStyle(palette.secondary) }
                else {
                    HStack(alignment: .center, spacing: 28) {
                        Chart(data.activities) { activity in
                            SectorMark(angle: .value("Recorded seconds", activity.seconds), innerRadius: .ratio(0.68), angularInset: data.activities.count > 1 ? 2 : 0)
                                .foregroundStyle(colors[activity.id] ?? palette.accent).cornerRadius(3)
                                .accessibilityLabel(activity.name).accessibilityValue(DurationText.short(activity.seconds))
                        }.chartLegend(.hidden).chartAngleSelection(value: $angle).frame(width: 190, height: 190)
                            .overlay { VStack(spacing: 5) { Text(DurationText.short(data.total)).font(.title3.bold()); Text("recorded").font(.caption).foregroundStyle(palette.secondary) }.allowsHitTesting(false) }
                        VStack(spacing: 8) {
                            ForEach(data.activities) { activity in
                                Button { select(activity.id) } label: {
                                    HStack(spacing: 10) {
                                        Circle().fill(colors[activity.id] ?? palette.accent).frame(width: 9, height: 9)
                                        Text(activity.name).frame(maxWidth: .infinity, alignment: .leading)
                                        Text(DurationText.short(activity.seconds)).monospacedDigit()
                                        Text((activity.seconds / data.total).formatted(.percent.precision(.fractionLength(0)))).foregroundStyle(palette.secondary).frame(width: 40, alignment: .trailing)
                                        Image(systemName: "line.3.horizontal.decrease.circle").foregroundStyle(palette.accent)
                                    }.padding(.vertical, 8).contentShape(Rectangle())
                                }.buttonStyle(.plain).help("Filter by " + activity.name)
                            }
                        }
                    }
                }
            }
        }.onChange(of: angle) { _, value in
            guard let value else { return }
            var start = 0.0
            for activity in data.activities {
                if value >= start && value < start + activity.seconds { angle = nil; select(activity.id); return }
                start += activity.seconds
            }
        }
    }
}

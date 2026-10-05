import SwiftUI
import Charts
import AzureTimetrackerCore

/// One interaction surface supports pointer inspection and drag-to-zoom without moving the chart's layout.
struct ExplorerTimeChart: View {
    @Environment(\.interfacePalette) private var palette

    let data: ExplorerAnalysis
    @Binding var selected: Date?
    let colors: [String: Color]
    let zoom: (DateInterval) -> Void
    @ViewState<Date?> private var hovered: Date? = nil
    @ViewState<Date?> private var dragStart: Date? = nil
    @ViewState<Date?> private var dragEnd: Date? = nil
    private var minutes: Bool { data.resolution == .quarter || data.resolution == .minute }
    private var divisor: Double { minutes ? 60 : 3600 }
    private var inspected: ExplorerBucket? {
        let date = hovered ?? selected
        return data.buckets.first { bucket in date.map { $0 >= bucket.start && $0 < bucket.end } ?? false }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if let inspected {
                    Text(label(inspected)).fontWeight(.medium)
                    Text(DurationText.short(inspected.seconds)).fontWeight(.semibold).foregroundStyle(palette.accent)
                } else { Text("Point to a bar for its total · drag to zoom · use controls below to inspect with the keyboard") }
            }.font(.caption).foregroundStyle(palette.secondary).frame(height: 18, alignment: .leading)
            Chart {
                ForEach(data.buckets) { bucket in
                    ForEach(bucket.segments) { segment in
                        RectangleMark(xStart: .value("From", bucket.start.addingTimeInterval(bucket.interval.duration * 0.06)),
                                      xEnd: .value("To", bucket.end.addingTimeInterval(-bucket.interval.duration * 0.06)),
                                      yStart: .value("Start", segment.bottom / divisor), yEnd: .value("Recorded", segment.top / divisor))
                            .foregroundStyle(colors[segment.activityID] ?? palette.accent)
                            .opacity(selected == nil || selected == bucket.start ? 1 : 0.55)
                            .accessibilityLabel(label(bucket) + ", " + segment.name)
                            .accessibilityValue(DurationText.short(segment.top - segment.bottom))
                    }
                }
                if let bucket = inspected {
                    RuleMark(x: .value("Inspected", bucket.start.addingTimeInterval(bucket.interval.duration / 2)))
                        .foregroundStyle(palette.secondary.opacity(0.7)).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
                if let start = dragStart, let end = dragEnd {
                    RectangleMark(xStart: .value("Selection start", min(start, end)), xEnd: .value("Selection end", max(start, end)))
                        .foregroundStyle(palette.accent.opacity(0.15))
                }
            }
            .chartLegend(.hidden)
            .chartXScale(domain: data.window.start...data.window.end)
            .chartYScale(domain: 0...max(minutes ? 5 : 1, (data.buckets.map(\.seconds).max() ?? 0) / divisor * 1.1))
            .chartYAxisLabel(minutes ? "Recorded minutes" : "Recorded hours")
            .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 5)) }
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) { value in
                AxisGridLine(); AxisTick(); AxisValueLabel {
                    if let date = value.as(Date.self) {
                        if data.resolution == .month { Text(date.formatted(.dateTime.month(.abbreviated))) }
                        else if data.resolution == .day { Text(date.formatted(.dateTime.day().month(.abbreviated))) }
                        else { Text(date.formatted(.dateTime.hour().minute())) }
                    }
                }
            } }
            .chartOverlay { proxy in
                GeometryReader { geometry in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .onContinuousHover { phase in
                            switch phase {
                            case .active(let point): hovered = chartDate(point, proxy: proxy, geometry: geometry)
                            case .ended: hovered = nil
                            }
                        }
                        .gesture(DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                if dragStart == nil { dragStart = chartDate(value.startLocation, proxy: proxy, geometry: geometry) }
                                if dragStart != nil { dragEnd = chartDate(value.location, proxy: proxy, geometry: geometry, clamp: true) }
                            }
                            .onEnded { value in
                                defer { dragStart = nil; dragEnd = nil; hovered = nil }
                                guard let start = dragStart, let end = dragEnd else { return }
                                if abs(value.translation.width) >= 8 {
                                    zoom(DateInterval(start: min(start, end), end: max(start, end)))
                                } else {
                                    selected = data.buckets.first { start >= $0.start && start < $0.end }?.start
                                }
                            })
                        .accessibilityHidden(true)
                }
            }
        }.onChange(of: data.window) { _, _ in hovered = nil; dragStart = nil; dragEnd = nil }
    }
    private func chartDate(_ point: CGPoint, proxy: ChartProxy, geometry: GeometryProxy, clamp: Bool = false) -> Date? {
        guard let anchor = proxy.plotFrame else { return nil }
        let plot = geometry[anchor]
        guard clamp || plot.contains(point) else { return nil }
        return proxy.value(atX: min(max(0, point.x - plot.minX), plot.width), as: Date.self)
    }
    private func label(_ bucket: ExplorerBucket) -> String {
        switch data.resolution {
        case .month: bucket.start.formatted(.dateTime.month(.wide).year())
        case .day: bucket.start.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        default: bucket.start.formatted(.dateTime.day().month(.abbreviated).hour().minute().timeZone()) + " – " + bucket.end.formatted(.dateTime.hour().minute().timeZone())
        }
    }
}

import Foundation

public struct ContextDay: Identifiable, Sendable {
    public var id: Date { date }
    public var date: Date
    public var switches = 0
    public var blocks: [Double] = []
    public init(date: Date, switches: Int = 0, blocks: [Double] = []) { self.date = date; self.switches = switches; self.blocks = blocks }
}
public struct ContextInsights: Sendable {
    public var days: [ContextDay]
    public var ambiguousEntries: Int
    public var switches: Int { days.reduce(0) { $0 + $1.switches } }
    public var longestBlock: Double { days.flatMap(\.blocks).max() ?? 0 }
    public var averageBlock: Double { let blocks = days.flatMap(\.blocks); return blocks.isEmpty ? 0 : blocks.reduce(0, +) / Double(blocks.count) }
    public static func calculate(logs: [WorkLog], range: StatisticsRange, calendar: Calendar = .current, now: Date = Date()) -> Self {
        struct Segment { var start: Date; var end: Date; var context: String }
        var byDay: [Date: [Segment]] = [:], seen = Set<String>(), omitted = Set<String>()
        for log in logs where seen.insert(log.id).inserted {
            guard let start = log.date, log.length.isFinite, log.length > 0, log.length <= Double(Int32.max) else { omitted.insert(log.id); continue }
            let end = min(start.addingTimeInterval(log.length), min(range.end, now))
            var cursor = max(start, range.start)
            let context = log.workItemId.flatMap { $0 > 0 ? "ticket:\($0)" : nil } ?? "activity:\(log.activityType?.id ?? "")|\(log.comment ?? "")"
            while cursor < end {
                let day = calendar.startOfDay(for: cursor), next = calendar.date(byAdding: .day, value: 1, to: day)!
                byDay[day, default: []].append(Segment(start: cursor, end: min(end, next), context: context)); cursor = next
            }
        }
        var days: [ContextDay] = [], ambiguous = omitted.count, day = range.start
        while day < range.end {
            let segments = (byDay[day] ?? []).sorted { $0.start < $1.start }
            var clusters: [[Segment]] = [], clusterEnd = Date.distantPast
            for segment in segments {
                if segment.start < clusterEnd { clusters[clusters.count - 1].append(segment); clusterEnd = max(clusterEnd, segment.end) }
                else { clusters.append([segment]); clusterEnd = segment.end }
            }
            var result = ContextDay(date: day), previous: Segment?
            for cluster in clusters {
                guard cluster.count == 1, let next = cluster.first else { ambiguous += cluster.count; previous = nil; continue }
                if let prior = previous {
                    let gap = next.start.timeIntervalSince(prior.end)
                    if gap <= 15 * 60, prior.context != next.context { result.switches += 1 }
                    if gap < 1, prior.context == next.context, !result.blocks.isEmpty {
                        result.blocks[result.blocks.count - 1] += next.end.timeIntervalSince(next.start)
                    } else { result.blocks.append(next.end.timeIntervalSince(next.start)) }
                } else { result.blocks.append(next.end.timeIntervalSince(next.start)) }
                previous = next
            }
            days.append(result); day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        return Self(days: days, ambiguousEntries: ambiguous)
    }
}

public enum WeeklyReport {
    public static func draft(logs: [WorkLog], range: StatisticsRange, targets: WorkTargets, titles: [Int: String], calendar: Calendar = .current) -> String {
        let data = ActivityStatistics.calculate(logs: logs, range: range, targets: targets, calendar: calendar)
        let insights = ContextInsights.calculate(logs: logs, range: range, calendar: calendar)
        let end = calendar.date(byAdding: .day, value: -1, to: range.end)!
        var lines = ["# Weekly status · " + range.start.formatted(date: .abbreviated, time: .omitted) + " – " + end.formatted(date: .abbreviated, time: .omitted), "", "Draft based on recorded time; add outcomes before sharing.", "", "## Time", "- Tracked: " + DurationText.short(data.totalSeconds), "- Weekly target: " + DurationText.short(data.targetSeconds), "", "## Worked on"]
        for ticket in data.tickets {
            let title = ticket.ticketID.map { "#\($0) · " + (titles[$0] ?? "Azure ticket") } ?? "Work without an Azure ticket"
            lines.append("- " + plain(title) + " — " + DurationText.short(ticket.seconds))
            let notes = Set(logs.filter { log in
                guard let date = log.date, date >= range.start, date < range.end, log.length.isFinite, log.length > 0 else { return false }
                return log.workItemId.flatMap { $0 > 0 ? $0 : nil } == ticket.ticketID
            }.compactMap { $0.comment?.nonEmpty }.map(plain)).sorted()
            lines += notes.map { "  - " + $0 }
        }
        if data.tickets.isEmpty { lines.append("- No recorded time in this week.") }
        lines += ["", "## Activity breakdown"] + data.activities.map { "- " + plain($0.name) + ": " + DurationText.short($0.seconds) }
        lines += ["", "## Work patterns", "- Recorded context switches: \(insights.switches)", "- Longest continuous recorded block: " + DurationText.short(insights.longestBlock), "- Based on worklogs, not a measurement of concentration. Switches after breaks longer than 15 minutes are excluded."]
        if insights.ambiguousEntries > 0 { lines.append("- \(insights.ambiguousEntries) invalid or overlapping segments excluded from work-pattern calculations.") }
        if data.omittedLogs > 0 { lines.append("- \(data.omittedLogs) invalid worklogs omitted from totals.") }
        return (lines + ["", "## Outcomes", "- [Add outcomes]", "", "## Blockers", "- [Add blockers or none]", "", "## Next week", "- [Add priorities]", ""]).joined(separator: "\n")
    }
    private static func plain(_ value: String) -> String {
        var result = value.components(separatedBy: .newlines).joined(separator: " ")
        for char in ["\\", "*", "_", "[", "]", "<", ">", "`"] { result = result.replacingOccurrences(of: char, with: "\\" + char) }
        return result
    }
}

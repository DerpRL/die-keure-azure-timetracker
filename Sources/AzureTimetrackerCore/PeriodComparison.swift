import Foundation

public struct ComparisonDelta: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let current: Double
    public let previous: Double
    public var difference: Double { current - previous }
    public var percentage: Double? { previous > 0 ? difference / previous * 100 : nil }
    public init(id: String, title: String, current: Double, previous: Double) {
        self.id = id; self.title = title; self.current = current; self.previous = previous
    }
}
public struct ComparisonBucket: Identifiable, Sendable {
    public let id: Int
    public let current: ExplorerBucket?
    public let previous: ExplorerBucket?
}
public struct PeriodComparison: Sendable {
    public let current: ExplorerAnalysis
    public let previous: ExplorerAnalysis
    public let activities: [ComparisonDelta]
    public let tasks: [ComparisonDelta]
    public let buckets: [ComparisonBucket]
    public static func windows(current: StatisticsRange, previous: StatisticsRange, matchElapsed: Bool, now: Date = Date(), calendar: Calendar = .current) -> (DateInterval, DateInterval) {
        let end = matchElapsed ? min(current.end, max(current.start, now)) : current.end
        var previousEnd = previous.end
        if matchElapsed, end < current.end {
            let offset = calendar.dateComponents([.day, .hour, .minute, .second], from: current.start, to: end)
            previousEnd = min(previous.end, calendar.date(byAdding: offset, to: previous.start)!)
        }
        return (DateInterval(start: current.start, end: end), DateInterval(start: previous.start, end: previousEnd))
    }
    public init(current: ExplorerAnalysis, previous: ExplorerAnalysis) {
        self.current = current; self.previous = previous
        func rows(_ a: [(String, String, Double)], _ b: [(String, String, Double)]) -> [ComparisonDelta] {
            let left = Dictionary(uniqueKeysWithValues: a.map { ($0.0, ($0.1, $0.2)) })
            let right = Dictionary(uniqueKeysWithValues: b.map { ($0.0, ($0.1, $0.2)) })
            return Set(left.keys).union(right.keys).map { id in
                ComparisonDelta(id: id, title: left[id]?.0 ?? right[id]!.0, current: left[id]?.1 ?? 0, previous: right[id]?.1 ?? 0)
            }.sorted { abs($0.difference) == abs($1.difference) ? $0.id < $1.id : abs($0.difference) > abs($1.difference) }
        }
        activities = rows(current.activities.map { ($0.id, $0.name, $0.seconds) }, previous.activities.map { ($0.id, $0.name, $0.seconds) })
        tasks = rows(current.tasks.map { ($0.id, $0.title, $0.seconds) }, previous.tasks.map { ($0.id, $0.title, $0.seconds) })
        buckets = (0..<max(current.buckets.count, previous.buckets.count)).map {
            ComparisonBucket(id: $0, current: current.buckets.indices.contains($0) ? current.buckets[$0] : nil,
                             previous: previous.buckets.indices.contains($0) ? previous.buckets[$0] : nil)
        }
    }
}

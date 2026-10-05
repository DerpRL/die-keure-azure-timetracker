import Foundation

public struct MeetingPreferences: Codable, Equatable, Sendable {
    public var enabled = true
    public var defaultTicket = ""
    public var activityTypeID = ""
    public init() {}
}

public struct MeetingEvent: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var start: Date
    public var end: Date
    public var calendar: String
    public var ticketID: Int?
    public var allDay: Bool
    public var cancelled: Bool
    public var declined: Bool
    public var free: Bool

    public init(id: String, title: String, start: Date, end: Date, calendar: String = "",
                ticketID: Int? = nil, allDay: Bool = false, cancelled: Bool = false,
                declined: Bool = false, free: Bool = false) {
        self.id = id; self.title = title; self.start = start; self.end = end; self.calendar = calendar
        self.ticketID = ticketID; self.allDay = allDay; self.cancelled = cancelled; self.declined = declined; self.free = free
    }
    public func isActive(at now: Date) -> Bool {
        !allDay && !cancelled && !declined && !free && start <= now && end > now
    }
}

public struct MeetingSuggestionEngine: Sendable {
    public private(set) var seen: [String: Date]
    public init(seen: [String: Date] = [:]) { self.seen = seen }

    /// A five-minute grace catches wake/reconnect without prompting for old meetings.
    /// Keys identify occurrences, so a recurring meeting can prompt again tomorrow.
    public mutating func due(events: [MeetingEvent], now: Date) -> [MeetingEvent] {
        seen = seen.filter { $0.value > now.addingTimeInterval(-172_800) }
        var result: [MeetingEvent] = []
        for event in events.sorted(by: { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }) {
            guard event.isActive(at: now), now.timeIntervalSince(event.start) <= 300,
                  seen[event.id] == nil else { continue }
            seen[event.id] = event.end
            result.append(event)
        }
        return result
    }
}

public enum MeetingTicket {
    /// Only explicit title markers and work-item URLs in the configured organization
    /// count. Arbitrary numbers in dates, Teams links, and notes are not ticket IDs.
    public static func extract(title: String, url: URL?, notes: String?, organization: String) -> Int? {
        var ids = Set<Int>()
        let marker = try! NSRegularExpression(pattern: #"(?<![\w#])(?:AB#|#)([1-9][0-9]{0,9})(?!\d|\.\d)"#, options: [.caseInsensitive])
        let range = NSRange(title.startIndex..., in: title)
        for match in marker.matches(in: title, range: range) {
            if let r = Range(match.range(at: 1), in: title), let id = Int(title[r]), id <= Int32.max { ids.insert(id) }
        }
        var urls = url.map { [$0] } ?? []
        let text = title + "\n" + (notes ?? "")
        let links = try! NSRegularExpression(pattern: #"https://[^\s<>\"']+"#, options: [.caseInsensitive])
        for match in links.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            if let r = Range(match.range, in: text), let link = URL(string: String(text[r]).trimmingCharacters(in: CharacterSet(charactersIn: ").,;]"))) { urls.append(link) }
        }
        let org = organization.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for link in urls where !org.isEmpty {
            guard link.scheme?.lowercased() == "https", link.user == nil, link.password == nil else { continue }
            let host = link.host?.lowercased() ?? ""
            let parts = link.pathComponents.filter { $0 != "/" }
            guard (host == "dev.azure.com" && parts.first?.lowercased() == org) || host == "\(org).visualstudio.com",
                  let marker = parts.firstIndex(of: "_workitems"), parts.indices.contains(marker + 2),
                  parts[marker + 1] == "edit", let id = Int(parts[marker + 2]), id > 0, id <= Int32.max else { continue }
            ids.insert(id)
        }
        return ids.count == 1 ? ids.first : nil
    }
}

public enum MeetingActivity {
    public static func suggestedID(title: String, preferredID: String, available: [ActivityType]) -> String? {
        if !preferredID.isEmpty { return available.first { $0.id == preferredID }?.id }
        func normalized(_ value: String) -> String {
            value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
                .filter(\.isLetter)
        }
        let meeting = normalized(title)
        let names = meeting.contains("standup") || meeting.contains("dailyscrum")
            ? ["standup", "overleg", "meeting", "meetings"] : ["overleg", "meeting", "meetings"]
        for name in names {
            if let type = available.first(where: { normalized($0.name ?? "") == name }) { return type.id }
        }
        return nil
    }
}

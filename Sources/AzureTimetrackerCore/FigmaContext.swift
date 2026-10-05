import Foundation

public struct FigmaPreferences: Codable, Equatable, Sendable {
    public var enabled = false
    public var dismissalMinutes = 15
    public var historyDays = 30
    public init() {}
}
public struct FigmaDocument: Codable, Equatable, Sendable {
    public let key: String
    public var name: String
    public init(key: String, name: String) { self.key = key; self.name = String(name.prefix(500)) }
    public static func validKey(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) }
    }
    public static func parse(_ address: String, title: String = "") -> Self? {
        var address = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if address.lowercased().hasPrefix("figma.com/") { address = "https://" + address }
        guard let url = URLComponents(string: address), url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(), ["figma.com", "www.figma.com"].contains(host),
              url.user == nil, url.password == nil, url.port == nil || url.port == 443 else { return nil }
        let parts = url.percentEncodedPath.split(separator: "/").map(String.init)
        guard parts.count >= 3, ["design", "file", "board", "slides"].contains(parts[0]), validKey(parts[1]) else { return nil }
        let slug = (parts[2].removingPercentEncoding ?? parts[2]).replacingOccurrences(of: "-", with: " ")
        return Self(key: parts[1], name: title.nonEmpty ?? slug.nonEmpty ?? "Figma file · " + parts[1])
    }
}
public enum FigmaObservation: Equatable, Sendable {
    case missingAccess, waiting, noAddress, file(FigmaDocument)
    public var document: FigmaDocument? { if case .file(let file) = self { file } else { nil } }
    public var foreground: Bool { if case .file = self { true } else { self == .noAddress } }
}
/// Pure detection state: it cannot start timers or write hours.
public struct FigmaActivation: Sendable {
    private var candidate: String?
    private var candidateSince: Date?
    private var lastActivated: String?
    private var awaySince: Date?
    private var lastSample: Date?
    public init() {}
    public mutating func observe(_ document: FigmaDocument?, at now: Date) -> Bool {
        if let lastSample, now.timeIntervalSince(lastSample) > 6 {
            candidate = nil; candidateSince = nil
            if awaySince == nil { awaySince = lastSample }
        }
        lastSample = now
        guard let document else {
            candidate = nil; candidateSince = nil
            if awaySince == nil { awaySince = now }
            return false
        }
        if let awaySince, now.timeIntervalSince(awaySince) >= 15 * 60 { lastActivated = nil }
        awaySince = nil
        if candidate != document.key { candidate = document.key; candidateSince = now; return false }
        guard let candidateSince, now.timeIntervalSince(candidateSince) >= 2, lastActivated != document.key else { return false }
        lastActivated = document.key; return true
    }
}
public struct FigmaFile: Codable, Equatable, Identifiable, Sendable {
    public var id: String { key }
    public let key: String
    public var name: String
    public var lastSeen: Date?
    public init(key: String, name: String, lastSeen: Date? = nil) { self.key = key; self.name = name; self.lastSeen = lastSeen }
}
public struct FigmaSuggestion: Codable, Equatable, Identifiable, Sendable {
    public var id = UUID()
    public let file: String
    public let name: String
    public let ticketID: Int?
    public var created: Date
    public var signature: String { file + "\u{0}" + (ticketID.map(String.init) ?? "") + "\u{0}" + name }
    public func isFresh(at now: Date) -> Bool { now >= created && now.timeIntervalSince(created) <= 86400 }
}
public struct FigmaContextEvent: Codable, Equatable, Identifiable, Sendable {
    public var id = UUID()
    public let timestamp: Date
    public let kind: String
    public let file: String
    public let name: String
    public let ticketID: Int?
}
public struct FigmaLedger: Codable, Equatable, Sendable {
    public var files: [String: FigmaFile] = [:]
    public var links: [String: Int] = [:]
    public var suggestions: [FigmaSuggestion] = []
    public var dismissals: [String: Date] = [:]
    public var history: [FigmaContextEvent] = []
    public init() {}
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        files = try c.decodeIfPresent([String: FigmaFile].self, forKey: .files) ?? [:]
        links = try c.decodeIfPresent([String: Int].self, forKey: .links) ?? [:]
        suggestions = try c.decodeIfPresent([FigmaSuggestion].self, forKey: .suggestions) ?? []
        dismissals = try c.decodeIfPresent([String: Date].self, forKey: .dismissals) ?? [:]
        history = try c.decodeIfPresent([FigmaContextEvent].self, forKey: .history) ?? []
    }
    public var register: [FigmaFile] {
        var result = files
        for key in links.keys where result[key] == nil && FigmaDocument.validKey(key) { result[key] = FigmaFile(key: key, name: "Figma file · " + key) }
        return result.values.sorted { ($0.lastSeen ?? .distantPast) == ($1.lastSeen ?? .distantPast) ? $0.key < $1.key : ($0.lastSeen ?? .distantPast) > ($1.lastSeen ?? .distantPast) }
    }
    public var lastWorked: [FigmaFile] {
        guard let latest = register.first(where: { links[$0.key] != nil }), let id = links[latest.key] else { return [] }
        return register.filter { links[$0.key] == id }
    }
    public mutating func observe(_ document: FigmaDocument) {
        var file = files[document.key] ?? FigmaFile(key: document.key, name: document.name)
        file.name = document.name; files[document.key] = file
    }
    public mutating func prune(at now: Date, preferences: FigmaPreferences) {
        suggestions = Array(suggestions.filter { $0.isFresh(at: now) }.suffix(12))
        dismissals = dismissals.filter { $0.value > now }
        history = Array(history.filter { now.timeIntervalSince($0.timestamp) < Double(max(1, min(365, preferences.historyDays))) * 86400 }.suffix(5000))
    }
    @discardableResult public mutating func activate(_ document: FigmaDocument, at now: Date, activeTicket: Int?, preferences: FigmaPreferences) -> FigmaSuggestion? {
        prune(at: now, preferences: preferences)
        suggestions.removeAll { $0.file != document.key }
        dismissals = dismissals.filter { $0.key.hasPrefix(document.key + "\u{0}") }
        observe(document); files[document.key]?.lastSeen = now
        history.append(FigmaContextEvent(timestamp: now, kind: "figma", file: document.key, name: document.name, ticketID: links[document.key]))
        history = Array(history.suffix(5000))
        guard activeTicket == nil || links[document.key] != activeTicket else { suggestions.removeAll { $0.file == document.key }; return nil }
        let proposal = FigmaSuggestion(file: document.key, name: document.name, ticketID: links[document.key], created: now)
        if let index = suggestions.firstIndex(where: { $0.signature == proposal.signature }) { suggestions[index].created = now; return nil }
        guard dismissals[proposal.signature].map({ $0 > now }) != true else { return nil }
        suggestions.removeAll { $0.file == document.key }; suggestions.append(proposal)
        return proposal
    }
    public func validate(_ id: UUID, at now: Date) throws -> FigmaSuggestion {
        guard let proposal = suggestions.first(where: { $0.id == id }), proposal.isFresh(at: now), links[proposal.file] == proposal.ticketID else {
            throw AppError.message("This Figma suggestion is outdated or its ticket link changed. Review the latest suggestion.")
        }
        return proposal
    }
    public mutating func dismiss(_ id: UUID, at now: Date, minutes: Int) {
        guard let suggestion = suggestions.first(where: { $0.id == id }) else { return }
        if minutes > 0 { dismissals[suggestion.signature] = now.addingTimeInterval(Double(min(120, minutes)) * 60) }
        suggestions.removeAll { $0.id == id }
    }
    public mutating func link(_ key: String, to ticket: Int?) throws {
        guard FigmaDocument.validKey(key), ticket.map({ $0 > 0 && $0 <= Int32.max }) ?? true else { throw AppError.message("Choose a valid file and Azure ticket number.") }
        if files[key] == nil { files[key] = FigmaFile(key: key, name: "Figma file · " + key) }
        links[key] = ticket; suggestions.removeAll { $0.file == key }
        dismissals = dismissals.filter { !$0.key.hasPrefix(key + "\u{0}") }
    }
}
public enum DesignActivity {
    public static func matches(_ activity: ActivityType) -> Bool { activity.name?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "design" }
    public static func selected(in activities: [ActivityType]) -> String? { activities.first(where: matches)?.id }
}
public struct FigmaStore: Codable, Equatable, Sendable {
    public var workspaces: [String: FigmaLedger] = [:]
    public init() {}
}

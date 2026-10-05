import Foundation

public enum MicrophoneApp: String, CaseIterable, Codable, Identifiable, Sendable {
    case slack = "Slack", teams = "Microsoft Teams", zoom = "Zoom", browsers = "Web browsers", webex = "Webex", discord = "Discord", faceTime = "FaceTime", other = "Other apps"
    public var id: Self { self }
    public var label: String { self == .browsers ? "Google Meet / web browsers" : rawValue }
    public static func classify(_ bundleID: String) -> Self {
        let id = bundleID.lowercased()
        func matches(_ prefix: String) -> Bool { id == prefix || id.hasPrefix(prefix + ".") }
        if matches("com.tinyspeck.slackmacgap") { return .slack }
        if matches("com.microsoft.teams") || matches("com.microsoft.teams2") { return .teams }
        if matches("us.zoom.xos") { return .zoom }
        if ["com.apple.safari", "com.google.chrome", "com.microsoft.edgemac", "org.mozilla.firefox", "com.brave.browser", "company.thebrowser.browser", "com.operasoftware.opera"].contains(where: matches) { return .browsers }
        if matches("com.cisco.webexmeetingsapp") || matches("com.cisco.webexteams") { return .webex }
        if matches("com.hnc.discord") { return .discord }
        if matches("com.apple.webkit") { return .browsers }
        if matches("com.apple.facetime") { return .faceTime }
        return .other
    }
}
public struct MicrophonePreferences: Codable, Equatable, Sendable {
    public var enabled = true
    public var apps: Set<MicrophoneApp> = [.slack, .teams, .zoom, .browsers]
    public init(enabled: Bool = true) { self.enabled = enabled }
}
public struct MicrophoneOwner: Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public var category: MicrophoneApp { MicrophoneApp.classify(id) }
    public init(id: String, name: String) { self.id = id; self.name = name }
}
public struct MicrophoneSession: Equatable, Identifiable, Sendable {
    public let id: String
    public let owner: MicrophoneOwner
    public let started: Date
    public init(id: String, owner: MicrophoneOwner, started: Date) { self.id = id; self.owner = owner; self.started = started }
}

/// Input use is a suggestion signal, never proof of a meeting or a reason to stop a timer automatically.
/// Requires consecutive successful samples; errors and sleep cannot establish an ending.
public struct MicrophoneMeetingEngine: Sendable {
    public private(set) var sessions: [String: MicrophoneSession] = [:]
    public private(set) var ended: Set<String> = []
    private var candidates: [String: Date] = [:]
    private var absentSince: [String: Date] = [:]
    private var announced: Set<String> = []
    private var lastSample: Date?
    public init() {}
    public mutating func restore(_ session: MicrophoneSession) {
        sessions[session.owner.id] = session; announced.insert(session.id)
    }
    public mutating func sample(_ owners: [MicrophoneOwner]?, at now: Date) {
        guard let owners else { candidates = [:]; absentSince = [:]; lastSample = nil; return }
        if lastSample.map({ now.timeIntervalSince($0) > 10 || now < $0 }) ?? false { candidates = [:]; absentSince = [:] }
        lastSample = now
        let active = Set(owners.map(\.id))
        candidates = candidates.filter { active.contains($0.key) }
        for owner in owners {
            absentSince[owner.id] = nil
            guard sessions[owner.id] == nil else { continue }
            let start = candidates[owner.id] ?? now; candidates[owner.id] = start
            if now.timeIntervalSince(start) >= 4 {
                sessions[owner.id] = MicrophoneSession(id: UUID().uuidString, owner: owner, started: start)
                candidates[owner.id] = nil
            }
        }
        for (app, session) in sessions where !active.contains(app) {
            let start = absentSince[app] ?? now; absentSince[app] = start
            if now.timeIntervalSince(start) >= 60 {
                ended.insert(session.id); sessions[app] = nil; absentSince[app] = nil
            }
        }
        if ended.count > 200 { ended = Set(ended.sorted().suffix(100)) }
        announced = announced.intersection(Set(sessions.values.map(\.id)))
    }
    public mutating func suggestions() -> [MicrophoneSession] {
        sessions.values.sorted { $0.started < $1.started }.filter { announced.insert($0.id).inserted }
    }
    public func isActive(_ session: MicrophoneSession) -> Bool { sessions[session.owner.id]?.id == session.id }
}

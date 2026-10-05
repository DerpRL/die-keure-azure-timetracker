import Foundation

public struct MicrophoneTrackingLink: Codable, Equatable, Sendable {
    public let sessionID: String
    public let appID: String
    public let appName: String
    public let started: Date
    public let workspace: String
    public let trackingIdentity: String
    public init(session: MicrophoneSession, workspace: String, trackingIdentity: String) {
        sessionID = session.id; appID = session.owner.id; appName = session.owner.name
        started = session.started; self.workspace = workspace; self.trackingIdentity = trackingIdentity
    }
    public var session: MicrophoneSession { MicrophoneSession(id: sessionID, owner: MicrophoneOwner(id: appID, name: appName), started: started) }
}

public struct MicrophoneEndPrompt: Codable, Equatable, Identifiable, Sendable {
    public var id = UUID()
    public let workspace: String
    public let trackingIdentity: String
    public let appNames: [String]
    public let endedAt: Date
    public var notified = false
    public func isValid(state: TrackingState?, workspace: String) -> Bool {
        self.workspace == workspace && state?.running == true && state?.identity == trackingIdentity
    }
}

/// Binds confirmed remote tracking to observed input use, independently of a previous ticket.
/// Ended sessions must come from the debounced microphone engine, never a missing/error sample.
public struct MicrophoneTrackingMonitor: Codable, Equatable, Sendable {
    public private(set) var links: [String: MicrophoneTrackingLink] = [:]
    public private(set) var pending: MicrophoneEndPrompt?
    public init() {}
    public mutating func restore(_ link: MicrophoneTrackingLink) { links[link.sessionID] = link }
    public mutating func restrict(to apps: Set<MicrophoneApp>, workspace: String) {
        links = links.filter { $0.value.workspace == workspace && apps.contains(MicrophoneApp.classify($0.value.appID)) }
        if pending?.workspace != workspace { pending = nil }
    }
    public mutating func reset() { links = [:]; pending = nil }
    public mutating func dismiss() { pending = nil }
    public mutating func markNotified() { pending?.notified = true }
    public mutating func reconcile(state: TrackingState?, workspace: String) {
        links = links.filter { $0.value.workspace == workspace && state?.running == true && $0.value.trackingIdentity == state?.identity }
        if pending?.isValid(state: state, workspace: workspace) == false { pending = nil }
    }
    public mutating func observe(sessions: [MicrophoneSession], inputAppIDs: Set<String>, ended: Set<String>,
                                 state: TrackingState?, workspace: String, fresh: Bool, confirmed: Bool, now: Date = Date()) {
        guard fresh, confirmed else { return }
        reconcile(state: state, workspace: workspace)
        guard let state, state.running, !workspace.isEmpty else { return }
        // A latched session survives brief muting. Only bind a new timer while input is actually observed.
        for session in sessions where inputAppIDs.contains(session.owner.id) {
            links[session.id] = MicrophoneTrackingLink(session: session, workspace: workspace, trackingIdentity: state.identity)
        }
        if !inputAppIDs.isEmpty { pending = nil; links = links.filter { !ended.contains($0.key) }; return }
        // Wait until all watched apps have completed their absence debounce.
        guard sessions.isEmpty else { return }
        let completed = links.values.filter { ended.contains($0.sessionID) }
        guard !completed.isEmpty else { return }
        if pending == nil {
            pending = MicrophoneEndPrompt(workspace: workspace, trackingIdentity: state.identity,
                                          appNames: Array(Set(completed.map(\.appName))).sorted(), endedAt: now)
        }
        for link in completed { links[link.sessionID] = nil }
    }
}

import Foundation

public struct TicketWorkflowStatus: Equatable, Sendable {
    public let ticketID: Int
    public let title: String
    public let state: String
    public let category: String
    public var completed: Bool { category.caseInsensitiveCompare("Completed") == .orderedSame }
    public init(ticketID: Int, title: String, state: String, category: String) {
        self.ticketID = ticketID; self.title = title; self.state = state; self.category = category
    }
}

public struct TicketCompletionPrompt: Codable, Equatable, Identifiable, Sendable {
    public var id = UUID()
    public let scope: String
    public let trackingIdentity: String
    public let ticketID: Int
    public let title: String
    public let workflowState: String
    public var notified = false
    public func matches(_ tracking: TrackingState?, scope: String) -> Bool {
        self.scope == scope && tracking?.running == true && tracking?.identity == trackingIdentity && tracking?.track?.ticketID == ticketID
    }
}

/// Decisions apply to one running session. A confirmed reopen permits a later completion reminder.
public struct TicketCompletionMonitor: Codable, Equatable, Sendable {
    public private(set) var pending: TicketCompletionPrompt?
    private var dismissed: [String: Date] = [:]
    public init() {}
    private func key(scope: String, identity: String) -> String { scope + "|" + identity }
    public mutating func reconcile(_ tracking: TrackingState?, scope: String) {
        if pending?.matches(tracking, scope: scope) == false { pending = nil }
    }
    public mutating func clearPrompt() { pending = nil }
    public mutating func markNotified() { pending?.notified = true }
    public mutating func keepTracking(now: Date = Date()) {
        guard let pending else { return }
        dismissed[key(scope: pending.scope, identity: pending.trackingIdentity)] = now
        self.pending = nil
    }
    public mutating func observe(_ status: TicketWorkflowStatus, tracking: TrackingState?, scope: String, confirmed: Bool, now: Date = Date()) {
        guard confirmed, !scope.isEmpty else { return }
        reconcile(tracking, scope: scope)
        guard let tracking, tracking.running, tracking.track?.ticketID == status.ticketID else { return }
        dismissed = dismissed.filter { now.timeIntervalSince($0.value) < 30 * 86400 }
        let decision = key(scope: scope, identity: tracking.identity)
        guard status.completed else { pending = nil; dismissed[decision] = nil; return }
        guard dismissed[decision] == nil, pending == nil else { return }
        pending = TicketCompletionPrompt(scope: scope, trackingIdentity: tracking.identity, ticketID: status.ticketID,
                                         title: status.title, workflowState: status.state)
    }
}

import Foundation

public enum TrackingIndicator: Equatable, Sendable {
    case running, stopped, paused, disconnected, connecting, attention

    public static func resolve(connected: Bool, connecting: Bool, state: TrackingState?, paused: Bool = false) -> Self {
        if connecting { return .connecting }
        guard connected, let state, let track = state.track, track.isRunning || track.isIdle else { return .disconnected }
        if state.track?.needsActivityCheck == true { return .attention }
        return state.running ? .running : paused ? .paused : .stopped
    }

    public var label: String {
        switch self {
        case .running: "Tracking"
        case .stopped: "Stopped"
        case .paused: "Paused"
        case .disconnected: "Disconnected"
        case .connecting: "Connecting"
        case .attention: "Check activity"
        }
    }
    public var symbol: String {
        switch self {
        case .running: "play.circle.fill"
        case .stopped: "stop.circle"
        case .paused: "pause.circle.fill"
        case .disconnected: "exclamationmark.triangle.fill"
        case .connecting: "arrow.triangle.2.circlepath"
        case .attention: "questionmark.circle.fill"
        }
    }
}

public struct PausedSession: Codable, Equatable, Sendable {
    public let ticketID: Int?
    public let remark: String?
    public let activityID: String?
    public let workspace: String
    public let pausedAt: Date
    public let elapsedSeconds: Double
    public init(ticketID: Int?, activityID: String?, workspace: String, pausedAt: Date, elapsedSeconds: Double, remark: String? = nil) {
        self.ticketID = ticketID; self.remark = remark; self.activityID = activityID; self.workspace = workspace
        self.pausedAt = pausedAt; self.elapsedSeconds = elapsedSeconds
    }
}

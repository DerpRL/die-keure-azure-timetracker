import Foundation

public struct TrackingAttention: Equatable, Sendable, Identifiable {
    public enum Reason: String, Sendable { case activityCheck, timeLimit, activityTimeout }
    public let id: String
    public let reason: Reason
    public let ticketID: Int?
    public let activityID: String?
    public let remark: String?
    public let title: String
    public var stopped: Bool { reason != .activityCheck }
    public static func from(_ state: TrackingState) -> Self? {
        guard let track = state.track else { return nil }
        let reason: Reason
        if track.isRunning, track.needsActivityCheck { reason = .activityCheck }
        else if track.isIdle {
            switch track.stoppedTrackType?.normalized {
            case "4", "stoppedbymaxsingletracklengthexceeded": reason = .timeLimit
            case "1", "stoppedbyactivitycheck": reason = .activityTimeout
            default: return nil
            }
        } else { return nil }
        // Server timestamps for the state transition remain stable across polls.
        let key = [reason.rawValue, track.workLogId ?? "", track.currentTrackStartedDateTime ?? "",
                   track.trackStatusChangeDate ?? "", String(track.ticketID ?? 0)].joined(separator: "|")
        return Self(id: key, reason: reason, ticketID: track.ticketID, activityID: track.activityTypeId,
                    remark: track.remark, title: track.title)
    }
    public var heading: String {
        switch reason {
        case .activityCheck: "Still working on this task?"
        case .timeLimit: "7pace stopped your timer at its time limit"
        case .activityTimeout: "7pace stopped after an unanswered activity check"
        }
    }
    public var detail: String {
        stopped ? "Continue with a new session, or keep this task stopped. Time since the stop will not be added automatically."
            : "7pace needs your response. Continue tracking or stop this session."
    }
}

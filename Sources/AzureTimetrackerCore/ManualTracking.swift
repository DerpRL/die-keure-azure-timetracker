import Foundation

public enum ManualTrackingKind: String, CaseIterable, Identifiable, Sendable {
    case activity, meeting, standup
    public var id: Self { self }
    public var label: String {
        switch self { case .activity: "Other activity"; case .meeting: "Meeting"; case .standup: "Stand-up" }
    }
    public func remark(comment: String, activity: ActivityType?) -> String {
        comment.nonEmpty ?? (self == .standup ? StandupActivity.remark : self == .meeting ? "Meeting" : activity?.name?.nonEmpty ?? "Unassigned work")
    }
}

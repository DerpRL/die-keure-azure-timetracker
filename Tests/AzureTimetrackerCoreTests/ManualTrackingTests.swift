import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct ManualTrackingTests {
    @Test func noTicketOrTitleRequired() {
        #expect(ManualTrackingKind.standup.remark(comment: "", activity: nil) == "daily standup")
        #expect(ManualTrackingKind.meeting.remark(comment: "  ", activity: nil) == "Meeting")
        #expect(ManualTrackingKind.activity.remark(comment: "", activity: ActivityType(id: "a", name: "Admin", color: nil)) == "Admin")
        #expect(ManualTrackingKind.activity.remark(comment: "", activity: nil) == "Unassigned work")
        #expect(ManualTrackingKind.meeting.remark(comment: "Sprint review", activity: nil) == "Sprint review")
    }
}

@Suite struct LocalTimerDisplayTests {
    @Test func localClockWhenRemoteIsIdleOrUnavailable() {
        let start = Date(timeIntervalSince1970: 100)
        var draft = OfflineDraft(workspace: "workspace", start: start, comment: "Meeting")
        #expect(LocalTimerDisplay.isPrimary(local: draft, remoteRunning: false, remoteConfirmed: true))
        #expect(LocalTimerDisplay.isPrimary(local: draft, remoteRunning: true, remoteConfirmed: false))
        #expect(!LocalTimerDisplay.isPrimary(local: draft, remoteRunning: true, remoteConfirmed: true))
        #expect(LocalTimerDisplay.elapsed(draft, at: start.addingTimeInterval(65)) == 65)
        #expect(LocalTimerDisplay.elapsed(draft, at: start.addingTimeInterval(-1)) == 0)
        draft.end = start.addingTimeInterval(80)
        #expect(!LocalTimerDisplay.isPrimary(local: draft, remoteRunning: false, remoteConfirmed: true))
        #expect(LocalTimerDisplay.elapsed(draft, at: start.addingTimeInterval(100)) == 80)
    }
}

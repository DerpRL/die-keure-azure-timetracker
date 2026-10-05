import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct MicrophoneTrackingEndTests {
    let slack = MicrophoneSession(id: "slack-call", owner: MicrophoneOwner(id: "com.tinyspeck.slackmacgap", name: "Slack"), started: Date())
    let zoom = MicrophoneSession(id: "zoom-call", owner: MicrophoneOwner(id: "us.zoom.xos", name: "Zoom"), started: Date())
    func observe(_ monitor: inout MicrophoneTrackingMonitor, sessions: [MicrophoneSession] = [], input: Set<String> = [], ended: Set<String> = [], state: TrackingState?, workspace: String = "org", fresh: Bool = true, confirmed: Bool = true) {
        monitor.observe(sessions: sessions, inputAppIDs: input, ended: ended, state: state, workspace: workspace, fresh: fresh, confirmed: confirmed)
    }
    func tracking() throws -> TrackingState {
        try JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":"tracking","workLogId":"standup-log","remark":"daily standup","activityTypeId":"standup"}}"#.utf8))
    }
    @Test func standaloneTicketFreeMeetingOffersEndWithoutPreviousTicket() throws {
        let state = try tracking(); var monitor = MicrophoneTrackingMonitor()
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: state)
        observe(&monitor, ended: [slack.id], state: state)
        let prompt = try #require(monitor.pending)
        #expect(prompt.appNames == ["Slack"] && prompt.isValid(state: state, workspace: "org"))
        #expect(monitor.links.isEmpty)
    }
    @Test func currentWorkCanBeTrackedThroughACallWithoutUsingStartSuggestion() throws {
        let running = try state(33984); var monitor = MicrophoneTrackingMonitor()
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: running)
        observe(&monitor, ended: [slack.id], state: running)
        #expect(monitor.pending?.trackingIdentity == running.identity)
    }
    @Test func idleAndUnboundTimersDoNotPrompt() throws {
        var monitor = MicrophoneTrackingMonitor()
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: try state())
        observe(&monitor, ended: [slack.id], state: try tracking())
        #expect(monitor.pending == nil)
    }
    @Test func shortMuteWaitsForEngineToConfirmEnd() throws {
        var monitor = MicrophoneTrackingMonitor(); let state = try tracking()
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: state)
        observe(&monitor, sessions: [slack], state: state)
        #expect(monitor.pending == nil)
        observe(&monitor, ended: [slack.id], state: state)
        #expect(monitor.pending != nil)
    }
    @Test func failuresAndDisconnectedStateNeverEstablishEnd() throws {
        var monitor = MicrophoneTrackingMonitor(); let state = try tracking()
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: state)
        observe(&monitor, ended: [slack.id], state: state, fresh: false)
        observe(&monitor, ended: [slack.id], state: state, confirmed: false)
        #expect(monitor.pending == nil && monitor.links.count == 1)
        observe(&monitor, ended: [slack.id], state: state)
        #expect(monitor.pending != nil)
    }
    @Test func anotherAppStillUsingInputDefersEnding() throws {
        var monitor = MicrophoneTrackingMonitor(); let state = try tracking()
        observe(&monitor, sessions: [slack, zoom], input: [slack.owner.id, zoom.owner.id], state: state)
        observe(&monitor, sessions: [zoom], input: [zoom.owner.id], ended: [slack.id], state: state)
        #expect(monitor.pending == nil)
        observe(&monitor, ended: [slack.id, zoom.id], state: state)
        #expect(monitor.pending?.appNames == ["Zoom"])
    }
    @Test func newerTimerDuringAbsenceCannotBeStoppedByOldReminder() throws {
        var monitor = MicrophoneTrackingMonitor(); let old = try tracking(), new = try state(123, session: "new")
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: old)
        observe(&monitor, sessions: [slack], state: new)
        observe(&monitor, ended: [slack.id], state: new)
        #expect(monitor.pending == nil && monitor.links.isEmpty)
    }
    @Test func switchDuringActiveInputBindsNewTimerAndOldPromptExpires() throws {
        var monitor = MicrophoneTrackingMonitor(); let old = try tracking(), next = try state(123, session: "next")
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: old)
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: next)
        observe(&monitor, ended: [slack.id], state: next)
        let prompt = try #require(monitor.pending)
        #expect(prompt.trackingIdentity == next.identity && !prompt.isValid(state: old, workspace: "org"))
        monitor.reconcile(state: old, workspace: "org"); #expect(monitor.pending == nil)
    }
    @Test func keepDoesNotRepeatAndInputResumptionDismissesPrompt() throws {
        let state = try tracking(); var monitor = MicrophoneTrackingMonitor()
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: state)
        observe(&monitor, ended: [slack.id], state: state)
        monitor.markNotified(); #expect(monitor.pending?.notified == true)
        monitor.dismiss(); observe(&monitor, ended: [slack.id], state: state)
        #expect(monitor.pending == nil)
        observe(&monitor, sessions: [zoom], input: [zoom.owner.id], state: state)
        observe(&monitor, ended: [zoom.id], state: state)
        #expect(monitor.pending != nil)
        observe(&monitor, input: [slack.owner.id], ended: [zoom.id], state: state)
        #expect(monitor.pending == nil)
    }
    @Test func restartsPreserveAssociationsAndPromptDeduplication() throws {
        let state = try tracking(); var monitor = MicrophoneTrackingMonitor()
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: state)
        monitor = try JSONDecoder().decode(MicrophoneTrackingMonitor.self, from: JSONEncoder().encode(monitor))
        #expect(monitor.links[slack.id]?.session == slack)
        observe(&monitor, ended: [slack.id], state: state); monitor.markNotified()
        let restored = try JSONDecoder().decode(MicrophoneTrackingMonitor.self, from: JSONEncoder().encode(monitor))
        #expect(restored == monitor && restored.pending?.notified == true)
    }
    @Test func stoppedTrackingWorkspaceChangesAndDisabledCategoriesClearBindings() throws {
        let state = try tracking(); var monitor = MicrophoneTrackingMonitor()
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: state)
        monitor.restrict(to: [.zoom], workspace: "org"); #expect(monitor.links.isEmpty)
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: state)
        observe(&monitor, ended: [slack.id], state: state, workspace: "other"); #expect(monitor.pending == nil)
        observe(&monitor, sessions: [slack], input: [slack.owner.id], state: state)
        observe(&monitor, ended: [slack.id], state: try self.stateStopped())
        #expect(monitor.pending == nil && monitor.links.isEmpty)
    }
    func stateStopped() throws -> TrackingState { try state() }
}

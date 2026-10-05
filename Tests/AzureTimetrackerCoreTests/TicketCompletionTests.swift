import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct TicketCompletionTests {
    let completed = TicketWorkflowStatus(ticketID: 123, title: "Finished task", state: "Gereed", category: "Completed")
    let active = TicketWorkflowStatus(ticketID: 123, title: "Task", state: "Active", category: "InProgress")
    @Test func customCompletedStatePromptsOnlyForTrackedTicket() throws {
        var monitor = TicketCompletionMonitor()
        monitor.observe(completed, tracking: try state(456), scope: "org", confirmed: true)
        #expect(monitor.pending == nil)
        monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: true)
        let prompt = try #require(monitor.pending)
        #expect(prompt.workflowState == "Gereed")
        #expect(prompt.matches(try state(123), scope: "org"))
        #expect(!prompt.matches(try state(123, session: "new"), scope: "org"))
        #expect(!prompt.matches(try state(123), scope: "other"))
    }
    @Test(arguments: ["Resolved", "InProgress", "Proposed", "Removed", "Unknown"])
    func stateNameAloneNeverImpliesCompletion(_ category: String) throws {
        let status = TicketWorkflowStatus(ticketID: 123, title: "Task", state: "Done", category: category)
        var monitor = TicketCompletionMonitor()
        monitor.observe(status, tracking: try state(123), scope: "org", confirmed: true)
        #expect(monitor.pending == nil)
    }
    @Test func idleAndUnconfirmedStatesDoNotPrompt() throws {
        var monitor = TicketCompletionMonitor()
        monitor.observe(completed, tracking: try state(), scope: "org", confirmed: true)
        monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: false)
        monitor.observe(completed, tracking: try state(123), scope: "", confirmed: true)
        #expect(monitor.pending == nil)
    }
    @Test func repeatedPollingPreservesPromptAndNotificationIdentity() throws {
        var monitor = TicketCompletionMonitor()
        monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: true)
        let id = monitor.pending?.id
        monitor.markNotified()
        monitor = try JSONDecoder().decode(TicketCompletionMonitor.self, from: JSONEncoder().encode(monitor))
        monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: true)
        #expect(monitor.pending?.id == id && monitor.pending?.notified == true)
    }
    @Test func keepSurvivesRestartButNewSessionsCanPrompt() throws {
        var monitor = TicketCompletionMonitor()
        monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: true)
        monitor.keepTracking()
        monitor = try JSONDecoder().decode(TicketCompletionMonitor.self, from: JSONEncoder().encode(monitor))
        monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: true)
        #expect(monitor.pending == nil)
        monitor.observe(completed, tracking: try state(123, session: "new"), scope: "org", confirmed: true)
        #expect(monitor.pending != nil)
    }
    @Test func reopenedTicketClearsPromptAndAllowsLaterCompletion() throws {
        var monitor = TicketCompletionMonitor()
        monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: true)
        monitor.keepTracking()
        monitor.observe(active, tracking: try state(123), scope: "org", confirmed: true)
        monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: true)
        #expect(monitor.pending != nil)
        monitor.observe(active, tracking: try state(123), scope: "org", confirmed: true)
        #expect(monitor.pending == nil)
    }
    @Test func stopSwitchAndWorkspaceChangesInvalidatePrompt() throws {
        for (tracking, scope) in [(try state(), "org"), (try state(456), "org"), (try state(123), "other")] {
            var monitor = TicketCompletionMonitor()
            monitor.observe(completed, tracking: try state(123), scope: "org", confirmed: true)
            monitor.reconcile(tracking, scope: scope)
            #expect(monitor.pending == nil)
        }
    }
    @Test func defaultsAndExplicitOptOutRoundTrip() throws {
        #expect(Configuration().completionRemindersEnabled)
        var config = Configuration(); config.completionRemindersEnabled = false
        let saved = try JSONDecoder().decode(Configuration.self, from: JSONEncoder().encode(config))
        #expect(!saved.completionRemindersEnabled)
    }
}

import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct FigmaContextTests {
    let now = Date(timeIntervalSince1970: 1_780_000_000)
    let a = FigmaDocument(key: "Alpha12", name: "First design")
    let b = FigmaDocument(key: "Beta34", name: "Board")
    @Test func exactHostAndFileURLsOnly() throws {
        #expect(FigmaDocument.parse("https://www.figma.com/design/n9ThKF7vJaGkvauPbXYLoR/UX-AI-Chat?node-id=18-766", title: "Canvas") == FigmaDocument(key: "n9ThKF7vJaGkvauPbXYLoR", name: "Canvas"))
        #expect(FigmaDocument.parse("figma.com/board/Ab12/Design%20Review")?.name == "Design Review")
        #expect(FigmaDocument.parse("https://FIGMA.COM/slides/A12/team-deck")?.name == "team deck")
        for url in ["https://figma.com.evil.test/design/Ab1/Test", "https://www.figma.com/files/team/123", "http://figma.com/file/A1/X", "https://user@figma.com/file/A1/X", "https://figma.com:8443/file/A1/X", "https://figma.com/design/key", "https://figma.com/file/A_1/Test", "https://figma.com/file/%41/Test", "https://figma.com/file/ä/Test"] {
            #expect(FigmaDocument.parse(url) == nil, "Accepted unexpected address: \(url)")
        }
        #expect(FigmaDocument.parse("https://figma.com/file/A1/Name", title: String(repeating: "x", count: 600))?.name.count == 500)
    }
    @Test func dwellSwitchReturnAndLongAbsence() {
        var engine = FigmaActivation()
        #expect({ !engine.observe(a, at: now) }())
        #expect({ !engine.observe(a, at: now.addingTimeInterval(1)) }())
        #expect({ engine.observe(a, at: now.addingTimeInterval(2)) }())
        #expect({ !engine.observe(a, at: now.addingTimeInterval(4)) }())
        #expect({ !engine.observe(b, at: now.addingTimeInterval(6)) }())
        #expect({ engine.observe(b, at: now.addingTimeInterval(8)) }())
        #expect({ !engine.observe(a, at: now.addingTimeInterval(10)) }())
        #expect({ engine.observe(a, at: now.addingTimeInterval(12)) }())
        #expect({ !engine.observe(nil, at: now.addingTimeInterval(14)) }())
        #expect({ !engine.observe(a, at: now.addingTimeInterval(30)) }())
        #expect({ !engine.observe(a, at: now.addingTimeInterval(32)) }())
        #expect({ !engine.observe(nil, at: now.addingTimeInterval(34)) }())
        #expect({ !engine.observe(a, at: now.addingTimeInterval(934)) }())
        #expect({ engine.observe(a, at: now.addingTimeInterval(936)) }())
    }
    @Test func interruptionsResetDwellAndMissedPollIsNotContinuous() {
        var engine = FigmaActivation()
        #expect({ !engine.observe(a, at: now) }())
        #expect({ !engine.observe(nil, at: now.addingTimeInterval(1)) }())
        #expect({ !engine.observe(a, at: now.addingTimeInterval(2)) }())
        #expect({ !engine.observe(a, at: now.addingTimeInterval(100)) }())
        #expect({ engine.observe(a, at: now.addingTimeInterval(102)) }())
    }
    @Test func observeIsMetadataOnlyAndActivationsArePersistable() throws {
        var ledger = FigmaLedger()
        ledger.observe(a)
        #expect(ledger.suggestions.isEmpty && ledger.history.isEmpty)
        #expect(ledger.files[a.key]?.lastSeen == nil)
        let proposal = try #require({ ledger.activate(a, at: now, activeTicket: nil, preferences: .init()) }())
        ledger.observe(FigmaDocument(key: a.key, name: "Renamed"))
        #expect(ledger.files[a.key]?.name == "Renamed")
        #expect(ledger.files[a.key]?.lastSeen == now)
        #expect(try ledger.validate(proposal.id, at: now.addingTimeInterval(5)) == proposal)
        #expect(try JSONDecoder().decode(FigmaLedger.self, from: JSONEncoder().encode(ledger)) == ledger)
    }
    @Test func suppressionExpiresButFileSwitchClearsIt() throws {
        var ledger = FigmaLedger()
        let proposal = try #require({ ledger.activate(a, at: now, activeTicket: nil, preferences: .init()) }())
        ledger.dismiss(proposal.id, at: now, minutes: 15)
        #expect({ ledger.activate(a, at: now.addingTimeInterval(10), activeTicket: nil, preferences: .init()) == nil }())
        #expect({ ledger.activate(a, at: now.addingTimeInterval(900), activeTicket: nil, preferences: .init()) != nil }())
        let next = try #require(ledger.suggestions.first)
        ledger.dismiss(next.id, at: now.addingTimeInterval(901), minutes: 120)
        _ = ledger.activate(b, at: now.addingTimeInterval(903), activeTicket: nil, preferences: .init())
        #expect({ ledger.activate(a, at: now.addingTimeInterval(906), activeTicket: nil, preferences: .init()) != nil }())
        #expect(ledger.suggestions.count == 1 && ledger.suggestions[0].file == a.key)
        ledger.dismiss(ledger.suggestions[0].id, at: now.addingTimeInterval(907), minutes: 0)
        #expect({ ledger.activate(a, at: now.addingTimeInterval(908), activeTicket: nil, preferences: .init()) != nil }())
    }
    @Test func linksInvalidateOldChoicesAndCurrentTicketSuppresses() throws {
        var ledger = FigmaLedger()
        let proposal = try #require({ ledger.activate(a, at: now, activeTicket: nil, preferences: .init()) }())
        try ledger.link(a.key, to: 42)
        #expect(throws: (any Error).self) { try ledger.validate(proposal.id, at: now) }
        #expect({ ledger.activate(a, at: now, activeTicket: 42, preferences: .init()) == nil }())
        let linked = try #require({ ledger.activate(a, at: now, activeTicket: 43, preferences: .init()) }())
        #expect(linked.ticketID == 42)
        #expect(throws: (any Error).self) { try ledger.validate(linked.id, at: now.addingTimeInterval(86401)) }
        try ledger.link(a.key, to: nil)
        #expect(ledger.files[a.key] != nil && ledger.links[a.key] == nil && ledger.suggestions.isEmpty)
    }
    @Test func lastWorkedUsesActivationsAndMigratesMappingOnlyStorage() throws {
        var ledger = try JSONDecoder().decode(FigmaLedger.self, from: Data(#"{"links":{"Legacy1":42}}"#.utf8))
        #expect(ledger.register.first?.name == "Figma file · Legacy1")
        _ = ledger.activate(a, at: now, activeTicket: nil, preferences: .init()); try ledger.link(a.key, to: 42)
        _ = ledger.activate(b, at: now.addingTimeInterval(10), activeTicket: nil, preferences: .init()); try ledger.link(b.key, to: 42)
        #expect(ledger.lastWorked.map(\.key) == [b.key, a.key, "Legacy1"])
        ledger.history = []; #expect(ledger.links.count == 3 && ledger.register.count == 3)
        #expect(DesignActivity.selected(in: [ActivityType(id: "design", name: "dEsIgN", color: nil)]) == "design")
        #expect(DesignActivity.selected(in: [ActivityType(id: "dev", name: "Development", color: nil)]) == nil)
    }
    @Test func historyRetentionAndWorkspaceIsolation() throws {
        var prefs = FigmaPreferences(); prefs.historyDays = 1
        var ledger = FigmaLedger()
        _ = ledger.activate(a, at: now, activeTicket: nil, preferences: prefs)
        _ = ledger.activate(b, at: now.addingTimeInterval(86401), activeTicket: nil, preferences: prefs)
        #expect(ledger.history.count == 1 && ledger.history[0].file == b.key)
        var store = FigmaStore(); store.workspaces["org-a|workspace"] = ledger
        #expect(store.workspaces["org-b|workspace"] == nil)
    }
    @Test func outdatedContextNeverMutatesTracking() async throws {
        let old = try state(100), stub = try StubTracker(initial: old, stopped: state())
        await #expect(throws: (any Error).self) {
            try await TrackingTransaction.switchTo(42, expectedIdentity: old.identity, activityType: "design", remark: nil, service: stub, validateContext: { throw AppError.message("Outdated Figma context") })
        }
        #expect(await stub.calls == ["current"])
    }
    @Test func ticketFreeCompletionClearsSuggestionAndPreservesSavedLinks() throws {
        var ledger = FigmaLedger()
        try ledger.link(a.key, to: 42)
        _ = ledger.activate(a, at: now, activeTicket: nil, preferences: .init())
        try ledger.completeTracking(a.key, ticketID: nil)
        #expect(ledger.suggestions.isEmpty)
        #expect(ledger.links[a.key] == 42)
        _ = ledger.activate(b, at: now, activeTicket: nil, preferences: .init())
        try ledger.completeTracking(b.key, ticketID: nil)
        #expect(ledger.links[b.key] == nil && ledger.suggestions.isEmpty)
        #expect(ledger.files[b.key]?.name == b.name)
        try ledger.completeTracking(b.key, ticketID: 43)
        #expect(ledger.links[b.key] == 43)
    }
    @Test(arguments: [false, true]) func ticketFreeDesignStartsWithFileComment(fromRunningTimer: Bool) async throws {
        let old = try state(fromRunningTimer ? 100 : nil)
        let stub = try StubTracker(initial: old, stopped: state())
        let result = try await TrackingTransaction.switchTo(nil, expectedIdentity: old.identity, activityType: "design", remark: a.name, service: stub)
        #expect(result.running && result.track?.ticketID == nil)
        #expect(result.track?.remark == a.name && result.track?.activityTypeId == "design")
        #expect(await stub.calls == (fromRunningTimer ? ["current", "stop", "start:unassigned"] : ["current", "start:unassigned"]))
    }
}

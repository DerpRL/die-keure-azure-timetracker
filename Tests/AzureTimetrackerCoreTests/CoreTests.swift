import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct BranchTests {
    @Test(arguments: ["develop", "Develop", "develop/33984-test", "long-feature", "long-feature/33984-platform", "LONG-FEATURE/33984-platform"])
    func integrationBranchesSuggestABreak(_ branch: String) throws {
        #expect(BranchPolicy.suggestsBreak(branch))
        #expect(try BranchTicket.extract(from: branch, pattern: Configuration().branchPattern) == nil)
        // The policy also takes precedence over custom ticket patterns.
        #expect(try BranchTicket.extract(from: branch, pattern: "([0-9]+)") == nil)
    }
    @Test(arguments: ["feature/33984-develop", "fix/33984-long-feature", "development/33984-test", "long-feature-fix/33984-test"])
    func ordinaryTicketBranchesKeepTheirSuggestions(_ branch: String) throws {
        #expect(!BranchPolicy.suggestsBreak(branch))
        #expect(try BranchTicket.extract(from: branch, pattern: Configuration().branchPattern) == 33984)
    }
    @Test func restoredIntegrationSuggestionIgnoresItsPreviouslyExtractedTicket() throws {
        let change = BranchChange(repository: Repository(path: "/tmp/repository"), branch: "long-feature/33984-platform", previousBranch: "feature/123-task", ticketID: 33984)
        let restored = try JSONDecoder().decode(BranchChange.self, from: JSONEncoder().encode(change))
        #expect(restored.suggestsBreak)
        #expect(restored.ticketID == 33984)
    }
    @Test(arguments: ["feature/33624-loading", "featute/33624-loading", "fix/33624", "33624-loading", "feature/AB#33624-loading"])
    func extractsTicket(_ branch: String) throws {
        #expect(try BranchTicket.extract(from: branch, pattern: Configuration().branchPattern) == 33624)
    }
    @Test(arguments: ["develop", "release/27.0.1", "feature/no-ticket", "fix/0-no", "feature/123-first/456-other", "feature/999999999999-too-big"])
    func ambiguousAndNonTicketBranches(_ branch: String) throws {
        #expect(try BranchTicket.extract(from: branch, pattern: Configuration().branchPattern) == nil)
    }
    @Test func rejectsPatternWithoutGroup() {
        #expect(throws: (any Error).self) { try BranchTicket.extract(from: "123", pattern: "[0-9]+") }
    }
    @Test func debouncesRapidCheckout() {
        let id = UUID(); var debounce = BranchDebouncer()
        let a = GitSnapshot(branch: "feature/1-a", head: "a")
        let b = GitSnapshot(branch: "feature/2-b", head: "b")
        let c = GitSnapshot(branch: "feature/3-c", head: "c")
        #expect(debounce.sample(a, repository: id) == nil)
        #expect(debounce.sample(a, repository: id)?.old == nil)
        #expect(debounce.sample(b, repository: id) == nil)
        #expect(debounce.sample(c, repository: id) == nil)
        let change = debounce.sample(c, repository: id)
        #expect(change?.old == a); #expect(change?.new == c)
        #expect(debounce.sample(c, repository: id) == nil)
    }
    @Test func repositoryAndRelativeWorktree() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = root.appendingPathComponent("repository with spaces")
        let git = repo.appendingPathComponent(".git")
        let worktree = root.appendingPathComponent("worktree")
        try FileManager.default.createDirectory(at: git.appendingPathComponent("worktrees/test"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: worktree, withIntermediateDirectories: true)
        try "ref: refs/heads/feature/33624-normal\n".write(to: git.appendingPathComponent("HEAD"), atomically: true, encoding: .utf8)
        try "gitdir: ../repository with spaces/.git/worktrees/test\n".write(to: worktree.appendingPathComponent(".git"), atomically: true, encoding: .utf8)
        try "ref: refs/heads/feature/33625-worktree\n".write(to: git.appendingPathComponent("worktrees/test/HEAD"), atomically: true, encoding: .utf8)
        #expect(try GitProbe.read(path: repo.path).branch == "feature/33624-normal")
        #expect(try GitProbe.read(path: worktree.path).branch == "feature/33625-worktree")
        try String(repeating: "a", count: 40).write(to: worktree.appendingPathComponent("../repository with spaces/.git/worktrees/test/HEAD"), atomically: true, encoding: .utf8)
        #expect(try GitProbe.read(path: worktree.path).branch == nil)
    }
}

func state(_ id: Int? = nil, session: String = "session", response: String = "OK", allowed: Bool = true, activity: String? = nil) throws -> TrackingState {
    let json = """
    {"track":{"tfsId":\(id.map(String.init) ?? "null"),"trackingState":"\(id == nil ? "idle" : "tracking")","workLogId":"\(session)","currentTrackLength":120,"currentTrackStartedDateTime":"2026-09-29T08:00:00Z"},"trackSettings":{"responseState":"\(response)","isTrackingStartAllowed":\(allowed),"responseMessage":"Server validation"},"timestamp":12}
    """
    var result = try JSONDecoder().decode(TrackingState.self, from: Data(json.utf8))
    result.track?.activityTypeId = activity
    return result
}

actor StubTracker: TrackingService {
    var calls: [String] = []
    var startedActivities: [String?] = []
    var initial: TrackingState
    var stopError: Bool
    var stopped: TrackingState
    var startError: Bool
    init(initial: TrackingState, stopped: TrackingState, stopError: Bool = false, startError: Bool = false) {
        self.initial = initial; self.stopped = stopped; self.stopError = stopError; self.startError = startError
    }
    func current() async throws -> TrackingState { calls.append("current"); return initial }
    func stop() async throws -> TrackingState {
        calls.append("stop")
        if stopError { throw URLError(.timedOut) }
        return stopped
    }
    func start(ticketID: Int?, activityType: String?, remark: String?) async throws -> TrackingState {
        calls.append("start:" + (ticketID.map(String.init) ?? "unassigned"))
        startedActivities.append(activityType)
        if startError { throw URLError(.timedOut) }
        var next = try state(ticketID, activity: activityType)
        next.track?.trackingState = .text("tracking"); next.track?.remark = remark
        return next
    }
}

@Suite struct TransactionTests {
    @Test func switchStopsThenStarts() async throws {
        let old = try state(100); let stub = try StubTracker(initial: old, stopped: state())
        let result = try await TrackingTransaction.switchTo(200, expectedIdentity: old.identity, activityType: nil, remark: nil, service: stub)
        #expect(result.track?.tfsId == 200)
        #expect(await stub.calls == ["current", "stop", "start:200"])
    }
    @Test func sameTicketDoesNotRestart() async throws {
        let old = try state(100); let stub = try StubTracker(initial: old, stopped: state())
        _ = try await TrackingTransaction.switchTo(100, expectedIdentity: old.identity, activityType: nil, remark: nil, service: stub)
        #expect(await stub.calls == ["current"])
    }
    @Test func changedRemoteSessionPreventsAllWrites() async throws {
        let old = try state(100, session: "old"); let stub = try StubTracker(initial: state(100, session: "new"), stopped: state())
        await #expect(throws: (any Error).self) {
            try await TrackingTransaction.switchTo(200, expectedIdentity: old.identity, activityType: nil, remark: nil, service: stub)
        }
        #expect(await stub.calls == ["current"])
    }
    @Test func failedStopNeverStarts() async throws {
        let old = try state(100); let stub = try StubTracker(initial: old, stopped: state(), stopError: true)
        await #expect(throws: (any Error).self) { try await TrackingTransaction.switchTo(200, expectedIdentity: old.identity, activityType: nil, remark: nil, service: stub) }
        #expect(await stub.calls == ["current", "stop"])
    }
    @Test func unconfirmedStopNeverStarts() async throws {
        let old = try state(100); let stub = StubTracker(initial: old, stopped: old)
        await #expect(throws: (any Error).self) { try await TrackingTransaction.switchTo(200, expectedIdentity: old.identity, activityType: nil, remark: nil, service: stub) }
        #expect(await stub.calls == ["current", "stop"])
    }
    @Test func timedOutStartIsNotReplayed() async throws {
        let old = try state(100); let stub = try StubTracker(initial: old, stopped: state(), startError: true)
        await #expect(throws: (any Error).self) { try await TrackingTransaction.switchTo(200, expectedIdentity: old.identity, activityType: nil, remark: nil, service: stub) }
        #expect(await stub.calls == ["current", "stop", "start:200"])
    }
    @Test func forbiddenStartDoesNotStopCurrentTimer() async throws {
        let old = try state(100, allowed: false); let stub = try StubTracker(initial: old, stopped: state())
        await #expect(throws: (any Error).self) { try await TrackingTransaction.switchTo(200, expectedIdentity: old.identity, activityType: nil, remark: nil, service: stub) }
        #expect(await stub.calls == ["current"])
    }
    @Test func idleStartsWithoutStop() async throws {
        let old = try state(); let stub = StubTracker(initial: old, stopped: old)
        _ = try await TrackingTransaction.switchTo(200, expectedIdentity: old.identity, activityType: nil, remark: nil, service: stub)
        #expect(await stub.calls == ["current", "start:200"])
    }
    @Test func stopRespectsRemoteChange() async throws {
        let old = try state(100); let stub = try StubTracker(initial: state(200), stopped: state())
        await #expect(throws: (any Error).self) { try await TrackingTransaction.stop(expectedIdentity: old.identity, service: stub) }
        #expect(await stub.calls == ["current"])
    }
    @Test func selectedActivityIsUsedForTheNewSession() async throws {
        let old = try state(100, activity: "development")
        let stub = try StubTracker(initial: old, stopped: state())
        let result = try await TrackingTransaction.switchTo(200, expectedIdentity: old.identity, activityType: "testing", remark: nil, service: stub)
        #expect(await stub.startedActivities == ["testing"])
        #expect(result.track?.activityTypeId == "testing")
    }
    @Test func sameTicketWithDifferentActivityStartsANewSession() async throws {
        let old = try state(100, activity: "development")
        let stub = try StubTracker(initial: old, stopped: state())
        _ = try await TrackingTransaction.switchTo(100, expectedIdentity: old.identity, activityType: "testing", remark: nil, service: stub)
        #expect(await stub.calls == ["current", "stop", "start:100"])
        #expect(await stub.startedActivities == ["testing"])
    }
    @Test func sameTicketAndActivityKeepsCurrentSession() async throws {
        let old = try state(100, activity: "development")
        let stub = try StubTracker(initial: old, stopped: state())
        _ = try await TrackingTransaction.switchTo(100, expectedIdentity: old.identity, activityType: "development", remark: nil, service: stub)
        #expect(await stub.calls == ["current"])
    }
}

@Suite struct ActivityChoiceTests {
    let activities = [ActivityType(id: "development", name: "Development", color: nil), ActivityType(id: "testing", name: "Testing", color: nil)]
    @Test func selectionIsRequiredWhenActivityTypesExist() {
        #expect(throws: (any Error).self) { try ActivityChoice.resolve("", available: activities) }
    }
    @Test func staleActivityIsRejected() {
        #expect(throws: (any Error).self) { try ActivityChoice.resolve("removed-activity", available: activities) }
    }
    @Test func explicitChoiceIsPreserved() throws {
        #expect(try ActivityChoice.resolve("testing", available: activities) == "testing")
    }
    @Test func workspacesWithoutActivityTypesUseServerDefault() throws {
        #expect(try ActivityChoice.resolve("", available: []) == nil)
    }
}

@Suite struct DecodingTests {
    @Test func errorsInHTTP200AreRejected() throws {
        let error = try state(100, response: "Error")
        #expect(throws: (any Error).self) { try error.checked() }
    }
    @Test func numericEnumsAndActivityChecks() throws {
        let decoded = try JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":3,"tfsId":17,"activityCheck":{"isRunning":true}},"trackSettings":{"responseState":0}}"#.utf8))
        #expect(try decoded.checked().running)
        #expect(decoded.track?.needsActivityCheck == true)
    }
    @Test func missingStateIsNotTreatedAsIdle() throws {
        let decoded = try JSONDecoder().decode(TrackingState.self, from: Data(#"{"timestamp":1}"#.utf8))
        #expect(throws: (any Error).self) { try decoded.checked() }
    }
    @Test func dateFormats() {
        #expect(WireDate.parse("2026-09-29T08:00:00.1234567Z") != nil)
        #expect(WireDate.parse("2026-09-29T10:00:00+02:00") == WireDate.parse("2026-09-29T08:00:00Z"))
        #expect(WireDate.parse("2026-09-29T10:00:00", localIfUnspecified: true) != nil)
        #expect(WireDate.parse("not a date") == nil)
    }
    @Test(arguments: ["http://org.timehub.7pace.com", "https://org.timehub.7pace.com.evil.test", "https://user:secret@org.timehub.7pace.com", "https://org.timehub.7pace.com/api", "https://org.timehub.7pace.com?foo=bar"])
    func rejectsUnsafeEndpoints(_ url: String) { #expect(throws: (any Error).self) { try Endpoint.sevenPace(url) } }
}

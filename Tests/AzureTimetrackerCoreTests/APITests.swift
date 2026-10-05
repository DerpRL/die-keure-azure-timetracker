import Foundation
import Testing
@testable import AzureTimetrackerCore

final class RequestCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    private var responses: [(Int, Data, [String: String])]
    init(_ responses: [(Int, Data, [String: String])]) { self.responses = responses }
    func receive(_ request: URLRequest) -> (Int, Data, [String: String]) {
        lock.lock(); defer { lock.unlock() }
        var captured = request
        if captured.httpBody == nil, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var data = Data(); var bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                data.append(contentsOf: bytes.prefix(count))
            }
            captured.httpBody = data
        }
        requests.append(captured)
        return responses.isEmpty ? (500, Data(), [:]) : responses.removeFirst()
    }
    func snapshot() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
}

final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var capture: RequestCapture?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let capture = Self.capture else { return }
        let (status, data, headers) = capture.receive(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite(.serialized) struct APITests {
    private func fixture(_ responses: [(Int, Data, [String: String])]) -> (SevenPaceAPI, RequestCapture, HTTPTransport) {
        let capture = RequestCapture(responses); MockURLProtocol.capture = capture
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MockURLProtocol.self]
        let transport = HTTPTransport(session: URLSession(configuration: config))
        return (SevenPaceAPI(baseURL: URL(string: "https://test.timehub.7pace.com")!, token: "fixture-token", transport: transport), capture, transport)
    }
    @Test func documentedStartAndStopContract() async throws {
        let active = try JSONEncoder().encode(state(33624))
        let idle = try JSONEncoder().encode(state())
        let (api, capture, _) = fixture([(200, active, [:]), (200, idle, [:])])
        _ = try await api.start(ticketID: 33624, activityType: nil, remark: nil)
        _ = try await api.stop()
        let requests = capture.snapshot()
        #expect(requests.count == 2)
        #expect(requests[0].url?.path == "/api/tracking/client/startTracking")
        #expect(requests[0].httpMethod == "POST")
        #expect(requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer fixture-token")
        let body = try JSONSerialization.jsonObject(with: #require(requests[0].httpBody)) as? [String: Any]
        #expect(body?["tfsId"] as? Int == 33624)
        #expect(body?["timeZone"] as? Int == TimeZone.current.secondsFromGMT() / 60)
        #expect(body?["activityTypeId"] == nil)
        let query = URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false)?.queryItems
        #expect(query?.contains(.init(name: "$reason", value: "0")) == true)
        #expect(query?.contains(.init(name: "api-version", value: "3.2")) == true)
    }
    @Test func currentExpandsAndValidates() async throws {
        let (api, capture, _) = fixture([(200, try JSONEncoder().encode(state(42)), [:])])
        #expect(try await api.current().track?.tfsId == 42)
        let request = try #require(capture.snapshot().first)
        #expect(request.url?.path == "/api/tracking/client/current")
        #expect(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains(.init(name: "$expand", value: "true")) == true)
    }
    @Test func chosenActivityIsIncludedInStartRequest() async throws {
        let body = try JSONEncoder().encode(state(33624, activity: "selected-activity"))
        let (api, capture, _) = fixture([(200, body, [:])])
        _ = try await api.start(ticketID: 33624, activityType: "selected-activity", remark: nil)
        let request = try #require(capture.snapshot().first)
        let parameters = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as? [String: Any]
        #expect(parameters?["activityTypeId"] as? String == "selected-activity")
    }
    @Test func standupRequestOmitsTicketAndSendsExactComment() async throws {
        var active = try state(nil, activity: "standup")
        active.track?.trackingState = .text("tracking"); active.track?.remark = "daily standup"
        let (api, capture, _) = fixture([(200, try JSONEncoder().encode(active), [:])])
        _ = try await api.start(ticketID: nil, activityType: "standup", remark: "daily standup")
        let request = try #require(capture.snapshot().first)
        let parameters = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as? [String: Any]
        #expect(parameters?["tfsId"] == nil)
        #expect(parameters?["activityTypeId"] as? String == "standup")
        #expect(parameters?["remark"] as? String == "daily standup")
    }
    @Test func figmaRequestOmitsTicketAndPreservesFileName() async throws {
        let name = "Boeke — lesoverzicht / élève"
        var active = try state(nil, activity: "design")
        active.track?.trackingState = .text("tracking"); active.track?.remark = name
        let (api, capture, _) = fixture([(200, try JSONEncoder().encode(active), [:])])
        _ = try await api.start(ticketID: nil, activityType: "design", remark: name)
        let request = try #require(capture.snapshot().first)
        let body = try #require(request.httpBody)
        let parameters = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(parameters["tfsId"] == nil)
        #expect(parameters["activityTypeId"] as? String == "design")
        #expect(parameters["remark"] as? String == name)
    }
    @Test func slackTokensUseOnlyAuthorizationHeadersAndErrorsAreRedacted() async throws {
        let (_, capture, transport) = fixture([(200, Data(#"{"ok":true,"team_id":"TTEAM01","user_id":"UUSER01"}"#.utf8), [:]), (200, Data(#"{"ok":false,"error":"invalid_auth","detail":"secret-response"}"#.utf8), [:])])
        let api = SlackAPI(transport: transport)
        let identity = try await api.identity(token: "xoxp-fixture")
        #expect(identity.team == "TTEAM01")
        let request = try #require(capture.snapshot().first)
        #expect(request.url?.host == "slack.com")
        #expect(request.url?.path == "/api/auth.test")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer xoxp-fixture")
        #expect(request.url?.absoluteString.contains("fixture") == false)
        do { _ = try await api.identity(token: "xoxp-fixture"); Issue.record("Expected rejection") }
        catch { #expect(!error.localizedDescription.contains("secret-response")) }
    }
    @Test func worklogsArePaginatedAndDeduplicated() async throws {
        let first: [[String: Any]] = (0..<500).map { ["id": "\($0)", "timestamp": "2026-09-29T10:00:00", "length": 60, "workItemId": 123] }
        let second: [[String: Any]] = [["id": "499", "timestamp": "2026-09-29T10:00:00", "length": 60], ["id": "500", "timestamp": "2026-09-29T11:00:00", "length": 120]]
        let (api, capture, _) = fixture([(200, try JSONSerialization.data(withJSONObject: ["data": first]), [:]), (200, try JSONSerialization.data(withJSONObject: ["data": second]), [:])])
        let logs = try await api.workLogs(from: Date().addingTimeInterval(-86400), to: Date())
        #expect(logs.count == 501)
        let requests = capture.snapshot()
        #expect(requests.count == 2)
        #expect(URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false)?.queryItems?.contains(.init(name: "$skip", value: "500")) == true)
    }
    @Test func rateLimitBlocksSubsequentRequests() async throws {
        let (api, capture, _) = fixture([(429, Data(), ["Retry-After": "120"])])
        await #expect(throws: (any Error).self) { try await api.current() }
        await #expect(throws: (any Error).self) { try await api.current() }
        #expect(capture.snapshot().count == 1)
    }
    @Test func authErrorDoesNotExposeResponseBody() async throws {
        let (api, _, _) = fixture([(401, Data("secret-response".utf8), [:])])
        do { _ = try await api.current(); Issue.record("Expected authentication error") }
        catch { #expect(!error.localizedDescription.contains("secret-response")); #expect(error.localizedDescription.contains("Authentication")) }
    }
    @Test func completionUsesTicketProjectAndWorkflowCategoryWithReadOnlyPATRequests() async throws {
        let data = Data(#"{"id":123,"fields":{"System.Title":"Task","System.State":"Gereed","System.TeamProject":"Another Project","System.WorkItemType":"User Story"}}"#.utf8)
        let categories = Data(#"{"value":[{"name":"Active","category":"InProgress"},{"name":"Gereed","category":"Completed"}]}"#.utf8)
        let (_, capture, transport) = fixture([(200, data, [:]), (200, categories, [:])])
        let api = try AzureAPI(organizationURL: Endpoint.azure("example"), project: "", pat: "fixture-pat", transport: transport)
        let status = try await api.ticketWorkflow(id: 123)
        #expect(status.completed && status.state == "Gereed")
        let requests = capture.snapshot()
        #expect(requests.count == 2)
        #expect(requests[1].url?.path == "/example/Another Project/_apis/wit/workitemtypes/User Story/states")
        for request in requests {
            #expect(request.httpMethod == "GET")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Basic " + Data(":fixture-pat".utf8).base64EncodedString())
        }
        let query = URLComponents(url: requests[0].url!, resolvingAgainstBaseURL: false)?.queryItems
        #expect(query?.first(where: { $0.name == "fields" })?.value?.contains("System.State") == true)
    }
    @Test func completionRejectsWrongTicketWithoutFetchingStates() async throws {
        let data = Data(#"{"id":456,"fields":{"System.State":"Done","System.TeamProject":"Project","System.WorkItemType":"Task"}}"#.utf8)
        let (_, capture, transport) = fixture([(200, data, [:])])
        let api = try AzureAPI(organizationURL: Endpoint.azure("example"), project: "", pat: "fixture-pat", transport: transport)
        await #expect(throws: (any Error).self) { try await api.ticketWorkflow(id: 123) }
        #expect(capture.snapshot().count == 1)
    }
    @Test func completionDoesNotGuessWhenCategoriesAreUnknownOrForbidden() async throws {
        let data = Data(#"{"id":123,"fields":{"System.State":"Done","System.TeamProject":"Project","System.WorkItemType":"Task"}}"#.utf8)
        for (code, response) in [(200, Data(#"{"value":[{"name":"Active","category":"InProgress"}]}"#.utf8)), (403, Data())] {
            let (_, _, transport) = fixture([(200, data, [:]), (code, response, [:])])
            let api = try AzureAPI(organizationURL: Endpoint.azure("example"), project: "", pat: "fixture-pat", transport: transport)
            await #expect(throws: (any Error).self) { try await api.ticketWorkflow(id: 123) }
        }
    }
    @Test func azureUsesPATAndEncodesProject() async throws {
        let data = Data(#"{"id":123,"fields":{"System.Title":"Fix timer","System.TeamProject":"A Project","System.WorkItemType":"Bug"}}"#.utf8)
        let (_, capture, transport) = fixture([(200, data, [:])])
        let api = try AzureAPI(organizationURL: Endpoint.azure("example"), project: "A Project", pat: "fixture-pat", transport: transport)
        let item = try await api.workItem(id: 123)
        #expect(item.title == "Fix timer")
        let request = try #require(capture.snapshot().first)
        #expect(request.url?.absoluteString.contains("A%20Project") == true)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Basic " + Data(":fixture-pat".utf8).base64EncodedString())
    }
}

private actor TokenPersistenceFixture {
    var writes = 0
    var failures: Int
    init(failures: Int = 0) { self.failures = failures }
    func save(_ next: SevenPaceTokens, _ old: SevenPaceTokens) throws {
        writes += 1
        if failures > 0 { failures -= 1; throw AppError.message("Fixture persistence failure") }
    }
}

extension APITests {
    @Test func pinCreationStatusAndExpiryUseDocumentedRequests() async throws {
        let (_, capture, transport) = fixture([
            (200, Data(#"{"pin":"123456","secret":"fixture-secret"}"#.utf8), [:]),
            (200, Data(#"{"status":"Validating"}"#.utf8), [:]),
            (200, Data(#"{"data":{"status":"Validated"}}"#.utf8), [:]),
            (200, Data(#"{"status":"WrongOrExpired"}"#.utf8), [:])])
        let oauth = try SevenPaceOAuth(workspace: URL(string: "https://test.timehub.7pace.com")!, transport: transport)
        let pin = try await oauth.createPIN()
        #expect(pin.pin == "123456")
        #expect(try await oauth.status(secret: pin.secret) == .waiting)
        #expect(try await oauth.status(secret: pin.secret) == .validated)
        #expect(try await oauth.status(secret: pin.secret) == .expired)
        let requests = capture.snapshot()
        #expect(requests[0].url?.path == "/api/pin/create")
        #expect(requests[1].url?.path == "/api/pin/status")
        #expect(requests.allSatisfy { $0.httpMethod == "POST" && $0.value(forHTTPHeaderField: "Authorization") == nil })
        #expect(requests[1].url?.query == "api-version=3.2")
        #expect(try JSONDecoder().decode(String.self, from: #require(requests[1].httpBody)) == pin.secret)
    }
    @Test func oauthExchangesSecretAndRotatesRefreshToken() async throws {
        let (_, capture, transport) = fixture([
            (200, Data(#"{"access_token":"access-1","refresh_token":"refresh+/=1","expires_in":"3600","token_type":"bearer"}"#.utf8), [:]),
            (200, Data(#"{"access_token":"access-2","refresh_token":"refresh-2","expires_in":3600}"#.utf8), [:]),
            (200, Data(#"{"access_token":"access-3","expires_in":3600}"#.utf8), [:])])
        let oauth = try SevenPaceOAuth(workspace: URL(string: "https://test.timehub.7pace.com")!, transport: transport)
        let first = try await oauth.exchange(secret: "secret+/= &")
        let second = try await oauth.refresh(first)
        let third = try await oauth.refresh(second)
        #expect(first.expiresAt.timeIntervalSinceNow > 3500)
        #expect(second.refreshToken == "refresh-2" && third.refreshToken == "refresh-2")
        let requests = capture.snapshot()
        #expect(requests.allSatisfy { $0.url?.path == "/token" && $0.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded" })
        #expect(String(decoding: requests[0].httpBody!, as: UTF8.self) == "client_id=OpenApi&grant_type=authorization_code&code=secret%2B%2F%3D%20%26")
        #expect(String(decoding: requests[1].httpBody!, as: UTF8.self) == "client_id=OpenApi&grant_type=refresh_token&refresh_token=refresh%2B%2F%3D1")
    }
    @Test func oauthRefreshIsSharedAndPersistedBeforeRequests() async throws {
        let (_, capture, transport) = fixture([(200, Data(#"{"access_token":"renewed","refresh_token":"rotated","expires_in":3600}"#.utf8), [:])])
        let persistence = TokenPersistenceFixture()
        let provider = SevenPaceTokenProvider(tokens: SevenPaceTokens(accessToken: "expired", refreshToken: "old", expiresAt: .distantPast), oauth: try SevenPaceOAuth(workspace: URL(string: "https://test.timehub.7pace.com")!, transport: transport), persist: { try await persistence.save($0, $1) })
        let values = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<20 { group.addTask { try await provider.accessToken() } }
            var values: [String] = []; for try await value in group { values.append(value) }; return values
        }
        #expect(values.count == 20 && values.allSatisfy { $0 == "renewed" })
        #expect(capture.snapshot().count == 1)
        #expect(await persistence.writes == 1)
        #expect(try await provider.accessToken() == "renewed")
        #expect(capture.snapshot().count == 1)
    }
    @Test func persistenceFailureRetriesStorageWithoutRotatingAgain() async throws {
        let (_, capture, transport) = fixture([(200, Data(#"{"access_token":"renewed","refresh_token":"rotated","expires_in":3600}"#.utf8), [:])])
        let persistence = TokenPersistenceFixture(failures: 1)
        let provider = SevenPaceTokenProvider(tokens: SevenPaceTokens(accessToken: "expired", refreshToken: "old", expiresAt: .distantPast), oauth: try SevenPaceOAuth(workspace: URL(string: "https://test.timehub.7pace.com")!, transport: transport), persist: { try await persistence.save($0, $1) })
        await #expect(throws: (any Error).self) { try await provider.accessToken() }
        #expect(try await provider.accessToken() == "renewed")
        #expect(capture.snapshot().count == 1)
        #expect(await persistence.writes == 2)
    }
    @Test func oauthTrackingWritesAreNotReplayedOnUnauthorizedResponse() async throws {
        let (_, capture, transport) = fixture([(401, Data("secret-response".utf8), [:])])
        let provider = SevenPaceTokenProvider(tokens: SevenPaceTokens(accessToken: "paired", refreshToken: "refresh", expiresAt: Date().addingTimeInterval(3600)), oauth: try SevenPaceOAuth(workspace: URL(string: "https://test.timehub.7pace.com")!, transport: transport), persist: { _, _ in })
        let api = SevenPaceAPI(baseURL: URL(string: "https://test.timehub.7pace.com")!, tokenProvider: provider, transport: transport)
        await #expect(throws: (any Error).self) { try await api.start(ticketID: 123, activityType: "dev", remark: nil) }
        #expect(capture.snapshot().count == 1)
        #expect(capture.snapshot()[0].value(forHTTPHeaderField: "Authorization") == "Bearer paired")
    }
    @Test func malformedPairingResponsesNeverExposeSecrets() async throws {
        let (_, _, transport) = fixture([(200, Data(#"{"status":"unknown-secret"}"#.utf8), [:]), (200, Data(#"{"access_token":"secret-value","expires_in":0}"#.utf8), [:])])
        let oauth = try SevenPaceOAuth(workspace: URL(string: "https://test.timehub.7pace.com")!, transport: transport)
        do { _ = try await oauth.status(secret: "secret"); Issue.record("Expected rejection") }
        catch { #expect(!error.localizedDescription.contains("unknown-secret")) }
        do { _ = try await oauth.exchange(secret: "secret"); Issue.record("Expected rejection") }
        catch { #expect(!error.localizedDescription.contains("secret-value")) }
        #expect(throws: (any Error).self) { try SevenPaceOAuth(workspace: URL(string: "https://attacker.test")!) }
    }
    @Test func slackHistoryRecoversOnlyHuddleMetadataAndPaginates() async throws {
        let response = Data(#"{"ok":true,"messages":[{"text":"private ordinary message"},{"subtype":"huddle_thread","text":"private huddle text","room":{"id":"RCALL01","date_start":1800000000,"date_end":0,"has_ended":false,"channels":["CCHAN01"],"participants":["PRIVATE"]}}],"response_metadata":{"next_cursor":"next-page"}}"#.utf8)
        let (_, capture, transport) = fixture([(200, response, [:])])
        let api = SlackAPI(transport: transport)
        let page = try await api.huddleHistory(token: "xoxp-fixture", channel: "CCHAN01", oldest: Date(timeIntervalSince1970: 1800000000), cursor: "previous-page")
        #expect(page.cursor == "next-page")
        let text = String(decoding: page.data, as: UTF8.self)
        #expect(!text.contains("private") && !text.contains("PRIVATE") && !text.contains("participants"))
        #expect(text.contains("RCALL01"))
        let request = try #require(capture.snapshot().first)
        #expect(request.url?.path == "/api/conversations.history")
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
        #expect(query?.contains(.init(name: "channel", value: "CCHAN01")) == true)
        #expect(query?.contains(.init(name: "cursor", value: "previous-page")) == true)
    }
}

extension APITests {
    @Test func worklogReadRequestsEditabilityAndPatchOnlyChangesTime() async throws {
        let original = editableLog(); var changed = original; changed.length = 7200
        let response = try JSONSerialization.data(withJSONObject: ["data": JSONSerialization.jsonObject(with: JSONEncoder().encode(original))])
        let changedResponse = try JSONSerialization.data(withJSONObject: ["data": JSONSerialization.jsonObject(with: JSONEncoder().encode(changed))])
        let (api, capture, _) = fixture([(200, response, [:]), (200, changedResponse, [:])])
        #expect(try await api.workLog(id: original.id).isCanEdit == true)
        let edit = WorkLogTimeEdit(start: original.date!, end: original.date!.addingTimeInterval(7200))
        #expect(try await api.updateWorkLogTime(id: original.id, edit: edit).length == 7200)
        let requests = capture.snapshot()
        #expect(requests[0].url?.query?.contains("$includeEditable=true") == true)
        #expect(requests[1].httpMethod == "PATCH")
        #expect(requests[1].url?.path == "/api/rest/workLogs/" + original.id)
        let body = try #require(JSONSerialization.jsonObject(with: requests[1].httpBody!) as? [String: Any])
        #expect(Set(body.keys) == ["timeStamp", "length"])
        #expect(body["length"] as? Int == 7200 && body["timeStamp"] as? String == original.timestamp)
    }
    @Test func overlapHistoryHasNoLowerBoundThatCouldHideLongEntries() async throws {
        let (api, capture, _) = fixture([(200, Data(#"{"data":[]}"#.utf8), [:])])
        _ = try await api.workLogs(before: localDate("2026-09-28T10:00:00"))
        let query = URLComponents(url: capture.snapshot()[0].url!, resolvingAgainstBaseURL: false)?.queryItems
        #expect(query?.contains { $0.name == "$fromTimestamp" } == false)
        #expect(query?.contains { $0.name == "$toTimestamp" } == true)
    }
    @Test func confirmingExpiredActivityPromptDoesNotSendWrite() async throws {
        let stopped = try TrackingAttentionTests().stopped(1)
        var checking = try state(123); checking.track?.trackingState = .number(3)
        let (api, capture, _) = fixture([(200, try JSONEncoder().encode(stopped), [:])])
        await #expect(throws: (any Error).self) { try await api.confirmActivity(expected: TrackingAttention.from(checking)) }
        #expect(capture.snapshot().count == 1 && capture.snapshot()[0].httpMethod == "GET")
    }
}

extension APITests {
    @Test func activityConfirmationRechecksAndVerifiesContinuedTracking() async throws {
        var checking = try state(123); checking.track?.trackingState = .number(3)
        let (api, capture, _) = fixture([(200, try JSONEncoder().encode(checking), [:]), (200, try JSONEncoder().encode(state(123)), [:])])
        #expect(try await api.confirmActivity(expected: TrackingAttention.from(checking)).running)
        #expect(capture.snapshot().map(\.httpMethod) == ["GET", "POST"])
        #expect(capture.snapshot()[1].url?.path == "/api/tracking/client/activityCheck")
    }
}

extension APITests {
    @Test func mutationCRUDUsesDocumentedBodiesAndOnly404MeansAbsent() async throws {
        var log = editableLog(); log.isCanDelete = true; log.billableLength = 1800
        let payload = try JSONSerialization.data(withJSONObject: ["data": JSONSerialization.jsonObject(with: JSONEncoder().encode(log))])
        let (api, capture, _) = fixture([(200,payload,[:]),(200,payload,[:]),(200,Data(#"{"data":{}}"#.utf8),[:]),(404,Data(),[:]),(403,Data(),[:])])
        let draft = try WorkLogDraft(log)
        _ = try await api.createWorkLog(draft); _ = try await api.replaceWorkLogTime(id: log.id, draft: draft)
        try await api.deleteWorkLog(id: log.id)
        #expect(try await api.findWorkLog(id: log.id) == nil)
        await #expect(throws: (any Error).self) { try await api.findWorkLog(id: log.id) }
        let requests = capture.snapshot()
        #expect(requests.map(\.httpMethod) == ["POST","PATCH","DELETE","GET","GET"])
        let createBody = try #require(requests[0].httpBody)
        let created = try #require(JSONSerialization.jsonObject(with: createBody) as? [String: Any])
        #expect(created["timeStamp"] as? String == log.timestamp && created["workItemId"] as? Int == 123 && created["billableLength"] as? Int == 1800)
        let editBody = try #require(requests[1].httpBody)
        let edited = try #require(JSONSerialization.jsonObject(with: editBody) as? [String: Any])
        #expect(Set(edited.keys) == ["timeStamp","length","billableLength"])
        #expect(requests[2].httpBody == nil)
    }
    @Test func azureContextRequestsRelationsAndUsesAzureAuthenticationOnly() async throws {
        let (_, capture, transport) = fixture([(200,Data(#"{"id":123,"fields":{"System.Title":"Context","System.State":"Active"},"relations":[]}"#.utf8),[:])])
        let api = AzureAPI(organizationURL: URL(string:"https://dev.azure.com/test")!, project: "Sample", pat: "fixture-pat", transport: transport)
        let result = try await api.ticketContext(id: 123)
        #expect(result.id == 123 && result.state == "Active")
        let request = try #require(capture.snapshot().first)
        #expect(request.url?.path == "/test/Sample/_apis/wit/workitems/123")
        #expect(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains(.init(name:"$expand",value:"Relations")) == true)
        #expect(request.value(forHTTPHeaderField:"Authorization") == "Basic " + Data(":fixture-pat".utf8).base64EncodedString())
    }
}

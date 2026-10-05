import Foundation

public enum Endpoint {
    public static func sevenPace(_ text: String) throws -> URL {
        guard let c = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              c.scheme == "https", let host = c.host?.lowercased(),
              host.hasSuffix(".timehub.7pace.com"), c.user == nil, c.password == nil,
              c.query == nil, c.fragment == nil, c.port == nil || c.port == 443,
              c.path.isEmpty || c.path == "/", let url = c.url else {
            throw AppError.message("Use your 7pace workspace URL: https://your-organization.timehub.7pace.com")
        }
        return url
    }
    public static func azure(_ organization: String) throws -> URL {
        let org = organization.trimmingCharacters(in: .whitespacesAndNewlines)
        guard org.range(of: #"^[A-Za-z0-9][A-Za-z0-9_-]*$"#, options: .regularExpression) != nil else {
            throw AppError.message("Enter the organization name from dev.azure.com/your-organization.")
        }
        return URL(string: "https://dev.azure.com")!.appendingPathComponent(org)
    }
}

public final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public actor HTTPTransport {
    private let session: URLSession
    private var retryAfter: [String: Date] = [:]
    public init(session: URLSession? = nil) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        config.httpCookieStorage = nil
        config.urlCache = nil
        self.session = session ?? URLSession(configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }
    public func data(for request: URLRequest) async throws -> Data {
        let host = request.url?.host ?? ""
        if let until = retryAfter[host], until > Date() { throw AppError.rateLimited(until) }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.message("The server did not return an HTTP response.") }
        switch http.statusCode {
        case 200..<300: return data
        case 401: throw AppError.authentication(host)
        case 403: throw AppError.accessDenied(host)
        case 404: throw AppError.notFound
        case 429:
            let value = http.value(forHTTPHeaderField: "Retry-After") ?? "60"
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
            let until = Double(value).map { Date().addingTimeInterval(max(1, $0)) } ?? f.date(from: value) ?? Date().addingTimeInterval(60)
            retryAfter[host] = until; throw AppError.rateLimited(until)
        case 300..<400: throw AppError.message("The server redirected the request. Check the exact workspace URL in Settings.")
        default: throw AppError.message("\(host) returned HTTP \(http.statusCode). Refresh to check the actual timer before trying again.")
        }
    }
}

public protocol TrackingService: Sendable {
    func current() async throws -> TrackingState
    func start(ticketID: Int?, activityType: String?, remark: String?) async throws -> TrackingState
    func stop() async throws -> TrackingState
}

public struct SevenPaceAPI: TrackingService, WorkLogMutationService, Sendable {
    public let baseURL: URL
    private let authorization: @Sendable () async throws -> String
    private let transport: HTTPTransport
    public init(baseURL: URL, token: String, transport: HTTPTransport = HTTPTransport()) {
        self.baseURL = baseURL; self.authorization = { token }; self.transport = transport
    }
    public init(baseURL: URL, tokenProvider: SevenPaceTokenProvider, transport: HTTPTransport = HTTPTransport()) {
        self.baseURL = baseURL; self.authorization = { try await tokenProvider.accessToken() }; self.transport = transport
    }
    private func call<T: Decodable & Sendable>(_ path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil) async throws -> T {
        var c = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "api-version", value: "3.2")] + query
        var request = URLRequest(url: c.url!)
        request.httpMethod = method; request.httpBody = body
        let token = try await authorization()
        try Task.checkCancellation()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return try JSONDecoder().decode(T.self, from: await transport.data(for: request))
    }
    public func current() async throws -> TrackingState {
        let state: TrackingState = try await call("api/tracking/client/current", query: [.init(name: "$expand", value: "true")])
        return try state.checked()
    }
    public func start(ticketID: Int?, activityType: String?, remark: String?) async throws -> TrackingState {
        struct Parameters: Encodable {
            let timeZone: Int; let tfsId: Int?; let remark: String?; let activityTypeId: String?
        }
        let body = try JSONEncoder().encode(Parameters(timeZone: TimeZone.current.secondsFromGMT() / 60, tfsId: ticketID, remark: remark, activityTypeId: activityType))
        let state: TrackingState = try await call("api/tracking/client/startTracking", method: "POST", body: body)
        return try state.checked()
    }
    public func stop() async throws -> TrackingState {
        let state: TrackingState = try await call("api/tracking/client/stopTracking", method: "POST", query: [.init(name: "$reason", value: "0")])
        return try state.checked()
    }
    public func confirmActivity(expected: TrackingAttention? = nil) async throws -> TrackingState {
        let actual = try await current()
        guard let attention = TrackingAttention.from(actual), !attention.stopped,
              expected == nil || attention.id == expected?.id else { throw AppError.remoteChanged }
        let state: TrackingState = try await call("api/tracking/client/activityCheck", method: "POST")
        let checked = try state.checked()
        guard checked.running, checked.track?.needsActivityCheck != true else { throw AppError.message("7pace did not confirm continued tracking. Refresh your timer before trying again.") }
        return checked
    }
    public func search(_ query: String) async throws -> [WorkItem] {
        struct Search: Encodable { var query: String }
        struct Item: Decodable, Sendable { var workItem: WorkItem }
        struct Results: Decodable, Sendable { var workItems: [Item] }
        let result: Results = try await call("api/tracking/client/searchByQuery", method: "POST", body: JSONEncoder().encode(Search(query: query)))
        return result.workItems.map(\.workItem)
    }
    public func activityTypes() async throws -> [ActivityType] {
        struct Types: Decodable, Sendable { var enabled: Bool; var activityTypes: [ActivityType]? }
        let result: Envelope<Types> = try await call("api/rest/activityTypes")
        return result.data.enabled ? result.data.activityTypes ?? [] : []
    }
    public func workLog(id: String) async throws -> WorkLog {
        guard UUID(uuidString: id) != nil else { throw AppError.message("This entry has an invalid 7pace worklog ID.") }
        let result: Envelope<WorkLog> = try await call("api/rest/workLogs/" + id, query: [.init(name: "$includeEditable", value: "true")])
        return result.data
    }
    public func updateWorkLogTime(id: String, edit: WorkLogTimeEdit) async throws -> WorkLog {
        try edit.validate()
        guard UUID(uuidString: id) != nil else { throw AppError.message("This entry has an invalid 7pace worklog ID.") }
        struct Body: Encodable { let timeStamp: String; let length: Int }
        let result: Envelope<WorkLog> = try await call("api/rest/workLogs/" + id, method: "PATCH",
            body: JSONEncoder().encode(Body(timeStamp: WireDate.localString(edit.start), length: edit.seconds)))
        return result.data
    }
    public func findWorkLog(id: String) async throws -> WorkLog? {
        do { return try await workLog(id: id) } catch AppError.notFound { return nil }
    }
    public func createWorkLog(_ draft: WorkLogDraft) async throws -> WorkLog {
        try draft.validate()
        struct Body: Encodable { let timeStamp: String; let length: Int; let billableLength: Int; let workItemId: Int?; let comment: String?; let activityTypeId: String?; let userId: String? }
        let result: Envelope<WorkLog> = try await call("api/rest/workLogs", method: "POST", body: JSONEncoder().encode(Body(timeStamp: WireDate.localString(draft.start), length: draft.seconds, billableLength: draft.billableSeconds, workItemId: draft.ticketID, comment: draft.comment, activityTypeId: draft.activityID, userId: draft.userID)))
        return result.data
    }
    public func replaceWorkLogTime(id: String, draft: WorkLogDraft) async throws -> WorkLog {
        try draft.validate()
        guard UUID(uuidString: id) != nil else { throw AppError.message("Invalid worklog ID.") }
        struct Body: Encodable { let timeStamp: String; let length: Int; let billableLength: Int }
        let result: Envelope<WorkLog> = try await call("api/rest/workLogs/" + id, method: "PATCH", body: JSONEncoder().encode(Body(timeStamp: WireDate.localString(draft.start), length: draft.seconds, billableLength: draft.billableSeconds)))
        return result.data
    }
    public func deleteWorkLog(id: String) async throws {
        guard UUID(uuidString: id) != nil else { throw AppError.message("Invalid worklog ID.") }
        struct Deleted: Decodable, Sendable {}
        let _: Deleted = try await call("api/rest/workLogs/" + id, method: "DELETE")
    }
    public func workLogs(before end: Date) async throws -> [WorkLog] {
        // No lower date bound: a long, older entry can still overlap the proposed time.
        try await workLogs(from: nil, to: end.addingTimeInterval(1))
    }
    public func workLogs(from: Date?, to: Date, includeEditable: Bool = false) async throws -> [WorkLog] {
        var logs: [WorkLog] = []; var skip = 0
        while true {
            try Task.checkCancellation()
            var query: [URLQueryItem] = [.init(name: "$toTimestamp", value: WireDate.localString(to)),
                .init(name: "$count", value: "500"), .init(name: "$skip", value: String(skip))]
            if let from { query.append(.init(name: "$fromTimestamp", value: WireDate.localString(from.addingTimeInterval(-1)))) }
            if includeEditable { query.append(.init(name: "$includeEditable", value: "true")) }
            let result: Envelope<[WorkLog]> = try await call("api/rest/workLogs", query: query)
            logs.append(contentsOf: result.data)
            if result.data.count < 500 { break }
            skip += 500
            guard skip <= 100_000 else { throw AppError.message("Select a shorter history range to load these worklogs.") }
        }
        var seen = Set<String>()
        return logs.filter { seen.insert($0.id).inserted }.sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }
}

private struct Envelope<T: Decodable & Sendable>: Decodable, Sendable { var data: T }

public struct AzureAPI: Sendable {
    private let organizationURL: URL
    private let project: String
    private let pat: String
    private let transport: HTTPTransport
    public init(organizationURL: URL, project: String, pat: String, transport: HTTPTransport = HTTPTransport()) {
        self.organizationURL = organizationURL; self.project = project; self.pat = pat; self.transport = transport
    }
    public func ticketContext(id: Int) async throws -> TicketContext {
        guard id > 0, id <= Int32.max else { throw AppError.message("Enter a valid Azure ticket number.") }
        var base = organizationURL
        if !project.isEmpty { base.appendPathComponent(project) }
        var c = URLComponents(url: base.appendingPathComponent("_apis/wit/workitems/\(id)"), resolvingAgainstBaseURL: false)!
        c.queryItems = [.init(name: "api-version", value: "7.1"), .init(name: "$expand", value: "Relations")]
        var request = URLRequest(url: c.url!)
        request.setValue("Basic " + Data(":\(pat)".utf8).base64EncodedString(), forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let result = try TicketContext.decode(await transport.data(for: request), organizationURL: organizationURL)
        guard result.id == id else { throw AppError.message("Azure returned a different ticket. Refresh the details.") }
        return result
    }
    public func workItem(id: Int) async throws -> WorkItem {
        var base = organizationURL
        if !project.isEmpty { base.appendPathComponent(project) }
        var c = URLComponents(url: base.appendingPathComponent("_apis/wit/workitems/\(id)"), resolvingAgainstBaseURL: false)!
        c.queryItems = [.init(name: "api-version", value: "7.1"), .init(name: "fields", value: "System.Title,System.TeamProject,System.WorkItemType")]
        var request = URLRequest(url: c.url!)
        request.setValue("Basic " + Data(":\(pat)".utf8).base64EncodedString(), forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        struct Item: Decodable { var id: Int; var fields: [String: String] }
        let item = try JSONDecoder().decode(Item.self, from: await transport.data(for: request))
        return WorkItem(id: item.id, title: item.fields["System.Title"] ?? "Work item #\(id)", teamProject: item.fields["System.TeamProject"], type: item.fields["System.WorkItemType"], workItemLink: base.appendingPathComponent("_workitems/edit/\(id)").absoluteString)
    }
}

/// A switch is stop → verified idle → start. No writes are retried: if a
/// response is lost the caller must reconcile from the server first.
public enum TrackingTransaction {
    public static func switchTo(_ id: Int?, expectedIdentity: String, activityType: String?, remark: String?, expectedAttention: TrackingAttention? = nil, service: any TrackingService) async throws -> TrackingState {
        guard id.map({ $0 > 0 && $0 <= Int32.max }) ?? (remark?.nonEmpty != nil) else {
            throw AppError.message("Choose a valid ticket or supply a tracking comment.")
        }
        let actual = try await service.current().checked()
        guard actual.identity == expectedIdentity else { throw AppError.remoteChanged }
        if let expectedAttention, TrackingAttention.from(actual)?.id != expectedAttention.id { throw AppError.remoteChanged }
        if actual.running, (actual.track?.tfsId.flatMap { $0 > 0 ? $0 : nil }) == id,
           activityType == nil || actual.track?.activityTypeId == activityType,
           remark == nil || actual.track?.remark == remark { return actual }
        guard actual.trackSettings?.isTrackingStartAllowed != false else {
            throw AppError.message("7pace does not currently allow starting a timer. Check your tracking settings.")
        }
        if actual.running {
            let stopped = try await service.stop().checked()
            guard !stopped.running else { throw AppError.message("7pace did not confirm that the current timer stopped. The new timer was not started.") }
        }
        let started = try await service.start(ticketID: id, activityType: activityType, remark: remark).checked()
        guard started.running, (started.track?.tfsId.flatMap { $0 > 0 ? $0 : nil }) == id else { throw AppError.message("7pace did not confirm the requested timer. Refresh before trying again.") }
        if let activityType, started.track?.activityTypeId != activityType {
            throw AppError.message("7pace did not confirm the selected activity type. Refresh and check the running timer before trying again.")
        }
        if let remark, started.track?.remark != remark {
            throw AppError.message("7pace did not confirm the tracking comment. Refresh and check the running timer before trying again.")
        }
        return started
    }
    public static func stop(expectedIdentity: String, service: any TrackingService) async throws -> TrackingState {
        let actual = try await service.current().checked()
        guard actual.identity == expectedIdentity else { throw AppError.remoteChanged }
        if !actual.running { return actual }
        let stopped = try await service.stop().checked()
        guard !stopped.running else { throw AppError.message("7pace did not confirm that tracking stopped.") }
        return stopped
    }
}

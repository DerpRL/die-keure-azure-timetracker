import Foundation

public enum SevenPaceAuthMode: String, Codable, CaseIterable, Sendable {
    case apiToken, mobilePIN
}

public struct SevenPaceTokens: Codable, Equatable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date
    public init(accessToken: String, refreshToken: String, expiresAt: Date) {
        self.accessToken = accessToken; self.refreshToken = refreshToken; self.expiresAt = expiresAt
    }
}

public struct SevenPacePIN: Decodable, Sendable {
    public let pin: String
    public let secret: String
}
public enum SevenPacePINStatus: Equatable, Sendable { case waiting, validated, expired }

public struct SevenPaceOAuth: Sendable {
    private let baseURL: URL
    private let transport: HTTPTransport
    public init(workspace: URL, transport: HTTPTransport = HTTPTransport()) throws {
        baseURL = try Endpoint.sevenPace(workspace.absoluteString); self.transport = transport
    }
    public func createPIN() async throws -> SevenPacePIN {
        let pin: SevenPacePIN = try await pinRequest("create")
        guard !pin.pin.isEmpty, !pin.secret.isEmpty else { throw AppError.message("7pace returned an incomplete pairing code. Request a new PIN.") }
        return pin
    }
    public func status(secret: String) async throws -> SevenPacePINStatus {
        struct Response: Decodable, Sendable { var status: String }
        let result: Response = try await pinRequest("status", body: JSONEncoder().encode(secret))
        switch result.status.lowercased() {
        case "validated": return .validated
        case "validating": return .waiting
        case "wrongorexpired", "invalid": return .expired
        default: throw AppError.message("7pace returned an unknown pairing status. Request a new PIN.")
        }
    }
    private func pinRequest<T: Decodable & Sendable>(_ action: String, body: Data? = nil) async throws -> T {
        var url = URLComponents(url: baseURL.appendingPathComponent("api/pin/" + action), resolvingAgainstBaseURL: false)!
        url.queryItems = [.init(name: "api-version", value: "3.2")]
        var request = URLRequest(url: url.url!); request.httpMethod = "POST"; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let data = try await transport.data(for: request)
        // PIN endpoints use bare responses; tolerate the common REST envelope as well.
        if let wrapped = try? JSONDecoder().decode(PINEnvelope<T>.self, from: data) { return wrapped.data }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw AppError.message("7pace returned an unreadable pairing response. Request a new PIN.") }
    }
    public func exchange(secret: String) async throws -> SevenPaceTokens {
        try await tokens(grant: "authorization_code", field: "code", value: secret, previousRefresh: nil)
    }
    public func refresh(_ previous: SevenPaceTokens) async throws -> SevenPaceTokens {
        try await tokens(grant: "refresh_token", field: "refresh_token", value: previous.refreshToken, previousRefresh: previous.refreshToken)
    }
    private func tokens(grant: String, field: String, value: String, previousRefresh: String?) async throws -> SevenPaceTokens {
        var request = URLRequest(url: baseURL.appendingPathComponent("token")); request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        request.httpBody = Data("client_id=OpenApi&grant_type=\(grant)&\(field)=\(value.addingPercentEncoding(withAllowedCharacters: allowed)!)".utf8)
        let data = try await transport.data(for: request)
        guard let response = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = response["access_token"] as? String, !access.isEmpty,
              let refresh = (response["refresh_token"] as? String)?.nonEmpty ?? previousRefresh,
              !refresh.isEmpty,
              let lifetime = (response["expires_in"] as? NSNumber)?.doubleValue ?? (response["expires_in"] as? String).flatMap(Double.init),
              lifetime.isFinite, lifetime > 0,
              ((response["token_type"] as? String)?.lowercased() ?? "bearer") == "bearer" else {
            throw AppError.message("7pace returned incomplete sign-in credentials. Pair again in Settings.")
        }
        return SevenPaceTokens(accessToken: access, refreshToken: refresh, expiresAt: Date().addingTimeInterval(lifetime))
    }
}
private struct PINEnvelope<T: Decodable & Sendable>: Decodable, Sendable { let data: T }

/// One renewal shared by all API clients. Credentials are persisted before use; tracking requests are never replayed.
public actor SevenPaceTokenProvider {
    private var tokens: SevenPaceTokens
    private let oauth: SevenPaceOAuth
    private let persist: @Sendable (SevenPaceTokens, SevenPaceTokens) async throws -> Void
    private var renewal: Task<SevenPaceTokens, Error>?
    private var unpersisted: SevenPaceTokens?
    public init(tokens: SevenPaceTokens, oauth: SevenPaceOAuth,
                persist: @escaping @Sendable (SevenPaceTokens, SevenPaceTokens) async throws -> Void) {
        self.tokens = tokens; self.oauth = oauth; self.persist = persist
    }
    public func accessToken() async throws -> String {
        if let renewal { return try await renewal.value.accessToken }
        guard tokens.expiresAt.timeIntervalSinceNow <= 60 else { return tokens.accessToken }
        let operation = Task { try await self.renew() }
        renewal = operation
        do {
            let next = try await operation.value; tokens = next; renewal = nil
            return next.accessToken
        } catch { renewal = nil; throw error }
    }
    private func renew() async throws -> SevenPaceTokens {
        let next: SevenPaceTokens
        if let unpersisted { next = unpersisted }
        else { next = try await oauth.refresh(tokens); unpersisted = next }
        // Retry local persistence, not a second refresh with an already-rotated token.
        try await persist(next, tokens)
        unpersisted = nil
        return next
    }
}

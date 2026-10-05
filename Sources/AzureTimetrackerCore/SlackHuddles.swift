import Foundation

public struct SlackPreferences: Codable, Equatable, Sendable {
    public var enabled = false
    public var workspaceID = ""
    public var channels = ""
    public var onlyWhenJoined = true
    public init() {}
    public func channelIDs() throws -> Set<String> {
        let values = channels.components(separatedBy: CharacterSet(charactersIn: ", \n\t")).filter { !$0.isEmpty }
        var result = Set<String>()
        for value in values {
            var id = value
            if let url = URL(string: value), url.scheme == "https", url.host?.hasSuffix(".slack.com") == true,
               let marker = url.pathComponents.firstIndex(of: "archives"), url.pathComponents.indices.contains(marker + 1) {
                id = url.pathComponents[marker + 1]
            }
            guard id.range(of: #"^[CG][A-Z0-9]{5,}$"#, options: .regularExpression) != nil else {
                throw AppError.message("Use Slack channel IDs (C… or G…) or copied channel links, separated by commas.")
            }
            result.insert(id)
        }
        guard result.count <= 20 else { throw AppError.message("Choose up to 20 stand-up channels.") }
        return result
    }
    public func validate() throws {
        guard enabled else { return }
        guard workspaceID.range(of: #"^T[A-Z0-9]{5,}$"#, options: .regularExpression) != nil else {
            throw AppError.message("Enter your Slack workspace ID (T…).")
        }
        guard try !channelIDs().isEmpty else { throw AppError.message("Choose at least one stand-up channel.") }
    }
}

public struct Huddle: Equatable, Identifiable, Sendable {
    public var id: String
    public var channelID: String
    public var started: Date
}

public enum StandupActivity {
    public static let remark = "daily standup"
    public static func matches(_ activity: ActivityType) -> Bool {
        (activity.name ?? "").lowercased().filter(\.isLetter) == "standup"
    }
    public static func selected(in activities: [ActivityType]) -> String? { activities.first(where: matches)?.id }
}

/// Retains only call/channel IDs and timestamps. Message bodies and profiles are discarded.
public struct HuddleEngine: Sendable {
    public var teamID: String
    public var userID: String
    public var channels: Set<String>
    public var onlyWhenJoined: Bool
    public private(set) var currentCallID: String?
    public private(set) var profileConfirmed = false
    public private(set) var rooms: [String: Huddle] = [:]
    public private(set) var ended: Set<String> = []
    public private(set) var seen: [String: Date]
    private var userTimestamp = -Double.infinity
    private var roomTimestamps: [String: Double] = [:]
    private var roomConfirmedAt: [String: Date] = [:]
    public init(teamID: String, userID: String, channels: Set<String>, onlyWhenJoined: Bool, seen: [String: Date] = [:]) {
        self.teamID = teamID; self.userID = userID; self.channels = channels; self.onlyWhenJoined = onlyWhenJoined; self.seen = seen
    }
    public mutating func profile(state: String?, callID: String?, timestamp: Double) {
        guard timestamp >= userTimestamp, let state else { return }
        // Missing/unknown fields are not proof that a huddle ended.
        guard ["in_a_huddle", "default_unset", "not_in_a_huddle"].contains(state) else { return }
        if state == "in_a_huddle", callID?.isEmpty != false { return }
        let next = state == "in_a_huddle" ? callID : nil
        if let old = currentCallID, old != next { ended.insert(old) }
        currentCallID = next; profileConfirmed = true; userTimestamp = timestamp
    }
    public mutating func consume(payload: Data, now: Date) {
        guard let outer = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
              outer["team_id"] as? String == teamID, let event = outer["event"] as? [String: Any] else { return }
        let timestamp = Self.number(event["event_ts"]) ?? Self.number(outer["event_time"]) ?? 0
        if ["user_huddle_changed", "user_change"].contains(event["type"] as? String ?? "") {
            guard let user = event["user"] as? [String: Any], user["id"] as? String == userID,
                  let profile = user["profile"] as? [String: Any] else { return }
            self.profile(state: profile["huddle_state"] as? String, callID: profile["huddle_state_call_id"] as? String, timestamp: timestamp)
        } else if event["type"] as? String == "message" {
            let message = event["message"] as? [String: Any] ?? event
            guard message["subtype"] as? String == "huddle_thread",
                  let room = message["room"] as? [String: Any],
                  let channel = event["channel"] as? String ?? message["channel"] as? String ?? (room["channels"] as? [String])?.first(where: { channels.contains($0) }), channels.contains(channel),
                  let id = room["id"] as? String,
                  id.hasPrefix("R"), timestamp >= (roomTimestamps[id] ?? 0) else { return }
            roomTimestamps[id] = timestamp
            if room["has_ended"] as? Bool == true || (Self.number(room["date_end"]) ?? 0) > 0 {
                ended.insert(id); rooms[id] = nil; return
            }
            guard !ended.contains(id), let start = Self.number(room["date_start"]), start > 0,
                  start <= now.timeIntervalSince1970 + 30, now.timeIntervalSince1970 - start < 43200 else { return }
            guard room["has_ended"] as? Bool == false || Self.number(room["date_end"]) == 0 || currentCallID == id else { return }
            rooms[id] = Huddle(id: id, channelID: channel, started: Date(timeIntervalSince1970: start))
            roomConfirmedAt[id] = now
        }
        rooms = rooms.filter { now.timeIntervalSince($0.value.started) < 43200 }
        if roomTimestamps.count > 500 { roomTimestamps = roomTimestamps.filter { now.timeIntervalSince1970 - $0.value < 86400 } }
    }
    public mutating func consumeHistory(_ data: Data, channel: String, observedAt: Date) {
        guard channels.contains(channel), let response = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let messages = response["messages"] as? [[String: Any]] else { return }
        for message in messages where message["subtype"] as? String == "huddle_thread" {
            var event = message
            event["type"] = "message"; event["channel"] = channel; event["event_ts"] = observedAt.timeIntervalSince1970
            if let payload = try? JSONSerialization.data(withJSONObject: ["team_id": teamID, "event": event]) {
                consume(payload: payload, now: observedAt)
            }
        }
    }
    public func isActive(_ huddle: Huddle, now: Date) -> Bool {
        rooms[huddle.id] == huddle && !ended.contains(huddle.id) && now.timeIntervalSince(huddle.started) < 43200 &&
            (onlyWhenJoined ? (profileConfirmed && currentCallID == huddle.id) : now.timeIntervalSince(roomConfirmedAt[huddle.id] ?? .distantPast) < 90)
    }
    public mutating func suggestions(now: Date) -> [Huddle] {
        seen = seen.filter { now.timeIntervalSince($0.value) < 172800 }
        return rooms.values.sorted { $0.started < $1.started }.filter { huddle in
            let key = teamID + ":" + huddle.id
            guard isActive(huddle, now: now), seen[key] == nil,
                  onlyWhenJoined || now.timeIntervalSince(huddle.started) <= 300 else { return false }
            seen[key] = now; return true
        }
    }
    private static func number(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let s = value as? String { return Double(s) }
        return nil
    }
}

public struct SlackAPI: Sendable {
    private let transport: HTTPTransport
    public init(transport: HTTPTransport = HTTPTransport()) { self.transport = transport }
    public func call(_ method: String, token: String, query: [URLQueryItem] = []) async throws -> Data {
        guard ["auth.test", "apps.connections.open", "users.info", "conversations.history"].contains(method) else { throw AppError.message("Unsupported Slack method.") }
        var components = URLComponents(string: "https://slack.com/api/" + method)!
        components.queryItems = query
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"; request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let data = try await transport.data(for: request)
        struct Result: Decodable { var ok: Bool; var error: String? }
        let response = try JSONDecoder().decode(Result.self, from: data)
        guard response.ok else {
            switch response.error {
            case "invalid_auth", "token_revoked", "token_expired", "not_authed", "account_inactive": throw AppError.authentication("Slack")
            case "missing_scope", "not_allowed_token_type", "no_permission": throw AppError.message("Slack token permissions are incomplete. Follow the Slack setup guide and reinstall your Slack app after changing scopes.")
            case "channel_not_found", "not_in_channel": throw AppError.message("Slack cannot read this channel. Check its C… / G… ID and that the token’s user belongs to it.")
            case "ratelimited": throw AppError.rateLimited(Date().addingTimeInterval(60))
            default: throw AppError.message("Slack could not complete the request. Check the Slack app configuration and retry.")
            }
        }
        return data
    }
    public func huddleHistory(token: String, channel: String, oldest: Date, cursor: String? = nil) async throws -> (data: Data, cursor: String?) {
        guard channel.range(of: #"^[CG][A-Z0-9]{5,}$"#, options: .regularExpression) != nil else { throw AppError.message("Invalid Slack channel ID.") }
        var query: [URLQueryItem] = [.init(name: "channel", value: channel), .init(name: "oldest", value: String(oldest.timeIntervalSince1970)), .init(name: "limit", value: "100")]
        if let cursor { query.append(.init(name: "cursor", value: cursor)) }
        let raw = try await call("conversations.history", token: token, query: query)
        guard let response = try JSONSerialization.jsonObject(with: raw) as? [String: Any], let messages = response["messages"] as? [[String: Any]] else {
            throw AppError.message("Slack returned unreadable channel history.")
        }
        // Retain huddle metadata only. Ordinary messages, text, blocks and participant lists are discarded.
        let rooms: [[String: Any]] = messages.compactMap { message in
            guard message["subtype"] as? String == "huddle_thread", let room = message["room"] as? [String: Any] else { return nil }
            let metadata = room.filter { ["id", "date_start", "date_end", "has_ended", "channels"].contains($0.key) }
            return ["subtype": "huddle_thread", "room": metadata]
        }
        let next = (response["response_metadata"] as? [String: Any])?["next_cursor"] as? String
        return (try JSONSerialization.data(withJSONObject: ["messages": rooms]), next?.nonEmpty)
    }
    public func identity(token: String) async throws -> (team: String, user: String) {
        struct Auth: Decodable { var team_id: String; var user_id: String; var bot_id: String? }
        let auth = try JSONDecoder().decode(Auth.self, from: await call("auth.test", token: token))
        guard auth.bot_id == nil else { throw AppError.message("Use your Slack User OAuth Token, not a bot token.") }
        return (auth.team_id, auth.user_id)
    }
    public func profile(token: String, user: String) async throws -> (state: String?, call: String?) {
        struct Profile: Decodable { var huddle_state: String?; var huddle_state_call_id: String? }
        struct User: Decodable { var profile: Profile }
        struct Response: Decodable { var user: User }
        let data = try await call("users.info", token: token, query: [.init(name: "user", value: user)])
        let profile = try JSONDecoder().decode(Response.self, from: data).user.profile
        return (profile.huddle_state, profile.huddle_state_call_id)
    }
    public func socketURL(token: String) async throws -> URL {
        struct Socket: Decodable { var url: String }
        let result = try JSONDecoder().decode(Socket.self, from: await call("apps.connections.open", token: token))
        return try Self.checkedSocketURL(result.url)
    }
    public static func checkedSocketURL(_ raw: String) throws -> URL {
        guard let url = URL(string: raw), url.scheme == "wss", url.host?.hasSuffix(".slack.com") == true,
              url.user == nil, url.password == nil, url.port == nil || url.port == 443 else {
            throw AppError.message("Slack returned an unexpected socket address.")
        }
        return url
    }
}

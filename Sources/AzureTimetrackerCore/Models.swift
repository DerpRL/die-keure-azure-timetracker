import Foundation

public struct Repository: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var path: String
    public var enabled: Bool
    public var name: String { URL(fileURLWithPath: path).lastPathComponent }
    public init(id: UUID = UUID(), path: String, enabled: Bool = true) {
        self.id = id; self.path = path; self.enabled = enabled
    }
}

public struct Configuration: Codable, Equatable, Sendable {
    public var organization = ""
    public var project = ""
    public var sevenPaceURL = ""
    public var sevenPaceAuthMode: SevenPaceAuthMode?
    public var repositories: [Repository] = []
    public var branchPattern = #"(?:^|/)(?:AB[−#_-]?)?([1-9][0-9]{0,8})(?=[_-]|$)"#
    public var autoStartWhenIdle = false
    public var notificationsEnabled = true
    public var watchEnabled = true
    public var calendarEnabled = false
    public var selectedCalendarIDs: [String] = []
    public var activityTypeID = ""
    public var pollSeconds = 60
    // Optional storage keeps settings created before meeting suggestions readable.
    public var slackHuddles: SlackPreferences?
    public var slack: SlackPreferences {
        get { slackHuddles ?? SlackPreferences() }
        set { slackHuddles = newValue }
    }
    public var microphoneMeetings: MicrophonePreferences?
    public var microphone: MicrophonePreferences {
        get { microphoneMeetings ?? MicrophonePreferences() }
        set { microphoneMeetings = newValue }
    }
    public var meetingSuggestions: MeetingPreferences?
    public var workTargets: WorkTargets?
    public var ticketCompletionReminders: Bool?
    public var completionRemindersEnabled: Bool {
        get { ticketCompletionReminders ?? true }
        set { ticketCompletionReminders = newValue }
    }
    public var quickSwitchEnabled: Bool?
    public var workAwareness: WorkAwarenessPreferences?
    public var awareness: WorkAwarenessPreferences {
        get { workAwareness ?? WorkAwarenessPreferences() }
        set { workAwareness = newValue }
    }
    public var endOfDayReview: DayReviewPreferences?
    public var dayReview: DayReviewPreferences {
        get { endOfDayReview ?? DayReviewPreferences() }
        set { endOfDayReview = newValue }
    }
    public var targets: WorkTargets {
        get { workTargets ?? WorkTargets() }
        set { workTargets = newValue }
    }
    public var meetings: MeetingPreferences {
        get { meetingSuggestions ?? MeetingPreferences() }
        set { meetingSuggestions = newValue }
    }
    public init() {}
}

public struct WorkItem: Codable, Identifiable, Equatable, Sendable {
    public var id: Int
    public var title: String
    public var teamProject: String?
    public var type: String?
    public var workItemLink: String?
    public init(id: Int, title: String, teamProject: String? = nil, type: String? = nil, workItemLink: String? = nil) {
        self.id = id; self.title = title; self.teamProject = teamProject; self.type = type; self.workItemLink = workItemLink
    }
}

// The tracking API can return enum names or their numeric representation.
public enum WireValue: Codable, Equatable, Sendable {
    case text(String), number(Int)
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) { self = .number(n) }
        else { self = .text(try c.decode(String.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .text(let s): try c.encode(s); case .number(let n): try c.encode(n) }
    }
    public var normalized: String {
        switch self { case .text(let s): s.lowercased(); case .number(let n): String(n) }
    }
}

public struct Track: Codable, Equatable, Sendable {
    public var tfsId: Int?
    public var activityTypeId: String?
    public var remark: String?
    public var workItem: WorkItem?
    public var trackingState: WireValue
    public var workLogId: String?
    public var currentTrackLength: Double?
    public var totalMeTodayLength: Double?
    public var currentTrackStartedDateTime: String?
    public var activityCheck: ActivityCheck?
    public var stoppedTrackType: WireValue? = nil
    public var trackStatusChangeDate: String? = nil
    public var ticketID: Int? { tfsId.flatMap { $0 > 0 ? $0 : nil } }
    public var isRunning: Bool { ["tracking", "activitycheck", "idlecheck", "0", "2", "3"].contains(trackingState.normalized) }
    public var isIdle: Bool { ["idle", "clientinputrequired", "1", "4"].contains(trackingState.normalized) }
    public var needsActivityCheck: Bool { activityCheck?.isRunning == true || ["activitycheck", "3"].contains(trackingState.normalized) }
    public var title: String { workItem?.title ?? remark?.nonEmpty ?? ticketID.map { "Work item #\($0)" } ?? "Unassigned time" }
    public var identity: String {
        guard isRunning else { return "idle" }
        return "\(workLogId ?? "")|\(tfsId ?? 0)|\(currentTrackStartedDateTime ?? "")"
    }
}

public struct ActivityCheck: Codable, Equatable, Sendable {
    public var isRunning: Bool?
    public var secondsLeft: Int?
}

public struct TrackSettings: Codable, Equatable, Sendable {
    public var isTrackingStartAllowed: Bool?
    public var responseState: WireValue?
    public var responseMessage: String?
    public var hasError: Bool { ["error", "autherror", "2", "3"].contains(responseState?.normalized ?? "") }
}

public struct TrackingState: Codable, Equatable, Sendable {
    public var track: Track?
    public var trackSettings: TrackSettings?
    public var timestamp: Int64?
    public var identity: String { track?.identity ?? "unknown" }
    public var running: Bool { track?.isRunning == true }
    public func checked() throws -> TrackingState {
        if trackSettings?.hasError == true {
            throw AppError.message(trackSettings?.responseMessage?.nonEmpty ?? "7pace rejected this request.")
        }
        guard let track, track.isRunning || track.isIdle else {
            throw AppError.message("7pace returned an unknown tracking state. Refresh before changing your timer.")
        }
        return self
    }
}

public struct ActivityType: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var name: String?
    public var color: String?
}

public enum ActivityChoice {
    public static func resolve(_ selectedID: String, available: [ActivityType]) throws -> String? {
        guard !available.isEmpty else { return nil }
        guard available.contains(where: { $0.id == selectedID }) else {
            throw AppError.message("Choose an activity type before starting the timer.")
        }
        return selectedID
    }
}

public struct WorkLogUser: Codable, Equatable, Sendable { public var id: String? }

public struct WorkLog: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var timestamp: String
    public var length: Double
    public var workItemId: Int?
    public var comment: String?
    public var activityType: ActivityType?
    public var isCanEdit: Bool? = nil
    public var editedTimestamp: String? = nil
    public var billableLength: Double? = nil
    public var isCanDelete: Bool? = nil
    public var user: WorkLogUser? = nil
    public var date: Date? { WireDate.parse(timestamp, localIfUnspecified: true) }
}

public enum WireDate {
    public static func parse(_ text: String, localIfUnspecified: Bool = false) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let result = iso.date(from: text) { return result }
        iso.formatOptions = [.withInternetDateTime]
        if let result = iso.date(from: text) { return result }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = localIfUnspecified ? .current : TimeZone(secondsFromGMT: 0)
        for pattern in ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSS", "yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss"] {
            f.dateFormat = pattern
            if let d = f.date(from: text) { return d }
        }
        return nil
    }
    public static func localString(_ date: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current; f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f.string(from: date)
    }
}

public enum AppError: LocalizedError, Sendable {
    case message(String)
    case authentication(String)
    case accessDenied(String)
    case remoteChanged
    case notFound
    case rateLimited(Date)
    public var errorDescription: String? {
        switch self {
        case .message(let message): message
        case .authentication(let host): "Authentication failed. Check the token for \(host) in Settings; it may have expired or been revoked."
        case .accessDenied(let host): "Access denied by \(host). Check your token permissions and 7pace license."
        case .notFound: "The requested entry or API endpoint was not found."
        case .remoteChanged: "Your timer changed in 7pace or another app. The current state has been refreshed; review it and try again."
        case .rateLimited(let date): "7pace is limiting requests. Try again after \(date.formatted(date: .omitted, time: .standard))."
        }
    }
}

public extension String {
    var nonEmpty: String? { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self }
}

public enum DurationText {
    public static func clock(_ seconds: Double) -> String {
        let s = Int(max(0, seconds))
        return String(format: "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }
    public static func short(_ seconds: Double) -> String {
        let minutes = Int(max(0, seconds)) / 60
        return "\(minutes / 60)h \(minutes % 60)m"
    }
}

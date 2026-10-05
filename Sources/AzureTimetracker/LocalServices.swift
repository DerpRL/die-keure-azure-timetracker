import AppKit
import AzureTimetrackerCore
import Combine
import CryptoKit
import EventKit
import Security
import UserNotifications

enum SecretStore {
    private static let service = "be.yarne.azure-timetracker"
    static func account(kind: String, scope: String) -> String { "\(kind):\(scope.lowercased())" }
    static func read(_ account: String) throws -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw AppError.message("Keychain could not read the saved credential (\(status)).")
        }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ value: String, account: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account]
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8)]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = query.merging(attributes) { _, new in new }
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw AppError.message("Keychain could not save the credential (\(status)).") }
    }
    static func delete(account: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account]
        let result = SecItemDelete(query as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw AppError.message("Keychain could not remove this credential (\(result)).") }
    }
}

struct SavedState: Codable {
    var configuration = Configuration()
    var audit: [AuditEntry] = []
    var pending: [BranchChange] = []
    var meetingReminders: [String: Date]? = nil
    var pausedSession: PausedSession? = nil
    var meetingReturn: MeetingReturn? = nil
    var ticketCompletion: TicketCompletionMonitor?
    var microphoneTracking: MicrophoneTrackingMonitor? = nil
    var quickTickets: QuickTickets? = nil
    var slackReminders: [String: Date]? = nil
    var dayReviews: [String: DayReviewRecord]? = nil
    var attentionNotified: [String: Date]? = nil
    var attentionDismissed: [String: Date]? = nil
}

struct LocalStore {
    let file: URL
    init() {
        #if UI_PREVIEW
        file = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("interface-preview-state.json")
        #else
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--data-dir"), args.indices.contains(index + 1) {
            file = URL(fileURLWithPath: args[index + 1]).appendingPathComponent("state.json")
        } else {
            file = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Azure timetracker/state.json")
        }
        #endif
    }
    func load() throws -> SavedState? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return try JSONDecoder().decode(SavedState.self, from: Data(contentsOf: file))
    }
    func save(_ state: SavedState) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(state).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}

struct AgendaEvent: Identifiable {
    var id: String
    var title: String
    var start: Date
    var end: Date
    var allDay: Bool
    var calendar: String
    var color: NSColor
    var location: String?
    var isNow: Bool { !allDay && start <= Date() && end > Date() }
}

@MainActor final class CalendarService: ObservableObject {
    @Published var events: [AgendaEvent] = []
    @Published var meetingEvents: [MeetingEvent] = []
    @Published var calendars: [EKCalendar] = []
    @Published var authorized = EKEventStore.authorizationStatus(for: .event) == .fullAccess
    @Published var error: String?
    @Published var selectedDate = Date()
    private let store = EKEventStore()
    func requestAccess() async {
        do {
            authorized = try await withCheckedThrowingContinuation { continuation in
                store.requestFullAccessToEvents { granted, error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: granted) }
                }
            }
            error = authorized ? nil : "Calendar access is off. Enable Azure timetracker in System Settings → Privacy & Security → Calendars."
        } catch { self.error = error.localizedDescription }
    }
    func refresh(selectedIDs: [String], enabled: Bool, organization: String) {
        authorized = EKEventStore.authorizationStatus(for: .event) == .fullAccess
        guard enabled && authorized else { events = []; meetingEvents = []; calendars = []; return }
        calendars = store.calendars(for: .event).sorted { $0.title < $1.title }
        let selected = selectedIDs.isEmpty ? calendars : calendars.filter { selectedIDs.contains($0.calendarIdentifier) }
        let start = Calendar.current.startOfDay(for: selectedDate)
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
        guard !selected.isEmpty else { events = []; meetingEvents = []; return }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: selected)
        let agendaEvents = store.events(matching: predicate)
        events = agendaEvents.filter { $0.status != .canceled }.map {
            AgendaEvent(id: ($0.eventIdentifier ?? UUID().uuidString) + String($0.startDate.timeIntervalSince1970),
                        title: $0.title ?? "Untitled event", start: $0.startDate, end: $0.endDate,
                        allDay: $0.isAllDay, calendar: $0.calendar.title,
                        color: $0.calendar.color, location: $0.location)
        }.sorted { a, b in a.allDay != b.allDay ? a.allDay : a.start < b.start }
        // Browsing another agenda date must never change the reminder clock.
        let today = Calendar.current.startOfDay(for: Date())
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: today)!
        let currentEvents = Calendar.current.isDateInToday(selectedDate) ? agendaEvents
            : store.events(matching: store.predicateForEvents(withStart: today, end: tomorrow, calendars: selected))
        meetingEvents = currentEvents.map { event in
            let occurrence = "\(event.calendar.calendarIdentifier)|\(event.calendarItemIdentifier)|\(event.startDate.timeIntervalSince1970)"
            let key = SHA256.hash(data: Data(occurrence.utf8)).map { String(format: "%02x", $0) }.joined()
            return MeetingEvent(id: key, title: event.title ?? "Untitled meeting", start: event.startDate, end: event.endDate,
                calendar: event.calendar.title,
                ticketID: MeetingTicket.extract(title: event.title ?? "", url: event.url, notes: event.notes, organization: organization),
                allDay: event.isAllDay, cancelled: event.status == .canceled,
                declined: event.attendees?.contains { $0.isCurrentUser && $0.participantStatus == .declined } == true,
                free: event.availability == .free)
        }
        error = nil
    }
}

@MainActor final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    var action: ((String, UUID) -> Void)?
    var openDayReview: (() -> Void)?
    var openTrackingAttention: (() -> Void)?
    private var attentionRequestID: String?
    var issue: ((String) -> Void)?
    let center = UNUserNotificationCenter.current()
    override init() {
        super.init(); center.delegate = self
        let keep = UNNotificationAction(identifier: "keep", title: "Keep tracking", options: [])
        let change = UNNotificationAction(identifier: "switch", title: "Review & switch", options: [.foreground])
        let reviewBreak = UNNotificationAction(identifier: "reviewBreak", title: "Review pause / stop", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "branch", actions: [keep, change], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "branch-break", actions: [keep, reviewBreak], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "tracking-attention", actions: [UNNotificationAction(identifier: "review-timer", title: "Review timer", options: [.foreground])], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "day-review", actions: [UNNotificationAction(identifier: "open-review", title: "Open day review", options: [.foreground])], intentIdentifiers: [], options: [])
        ])
    }
    func enable() async -> Bool {
        do { return try await center.requestAuthorization(options: [.alert, .sound, .badge]) }
        catch { issue?(error.localizedDescription); return false }
    }
    func post(_ change: BranchChange, running: Bool) async {
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = running ? "New branch. Keep your timer?" : "Ready to start tracking?"
        content.body = "\(change.repositoryName) · \(change.branch)" + (change.ticketID.map { "\nSwitch to Azure ticket #\($0), or keep your current tracking." } ?? "\nChoose an Azure ticket in the app.")
        if change.suggestsBreak {
            content.title = running ? "Pause or stop your timer?" : "No ticket tracking suggested"
            content.body = "\(change.repositoryName) · \(change.branch)\nDevelop and long-feature branches suggest a pause or stop."
        }
        content.categoryIdentifier = change.suggestsBreak ? "branch-break" : "branch"; content.sound = .default
        content.userInfo = ["changeID": change.id.uuidString]
        do { try await center.add(UNNotificationRequest(identifier: change.id.uuidString, content: content, trigger: nil)) }
        catch { issue?("Notification could not be delivered: \(error.localizedDescription)") }
    }
    func remove(_ ids: [UUID]) {
        center.removeDeliveredNotifications(withIdentifiers: ids.map(\.uuidString))
        center.removePendingNotificationRequests(withIdentifiers: ids.map(\.uuidString))
    }
    func postDayReview() async {
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = "Time to review your day"
        content.body = "Check your tracked time and current timer before finishing."
        content.categoryIdentifier = "day-review"; content.sound = .default
        do { try await center.add(UNNotificationRequest(identifier: "day-review", content: content, trigger: nil)) }
        catch { issue?("Day review notification could not be delivered: \(error.localizedDescription)") }
    }
    func postTrackingAttention(_ prompt: TrackingAttention) async {
        attentionRequestID = prompt.id
        let settings = await center.notificationSettings()
        guard attentionRequestID == prompt.id, settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = prompt.heading
        content.body = (prompt.ticketID.map { "#\($0) · " } ?? "") + prompt.title + "\n" + prompt.detail
        content.categoryIdentifier = "tracking-attention"; content.sound = .default
        do { try await center.add(UNNotificationRequest(identifier: "tracking-attention", content: content, trigger: nil)) }
        catch { issue?("Timer notification could not be delivered: \(error.localizedDescription)") }
    }
    func removeTrackingAttention() {
        attentionRequestID = nil
        center.removeDeliveredNotifications(withIdentifiers: ["tracking-attention"])
        center.removePendingNotificationRequests(withIdentifiers: ["tracking-attention"])
    }
    func removeDayReview() { center.removeDeliveredNotifications(withIdentifiers: ["day-review"]) }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.notification.request.content.categoryIdentifier == "tracking-attention", response.actionIdentifier != UNNotificationDismissActionIdentifier {
            Task { @MainActor in self.openTrackingAttention?() }
        }
        if response.notification.request.content.categoryIdentifier == "day-review", response.actionIdentifier != UNNotificationDismissActionIdentifier {
            Task { @MainActor in self.openDayReview?() }
        }
        if let raw = response.notification.request.content.userInfo["changeID"] as? String, let id = UUID(uuidString: raw) {
            let actionID = response.actionIdentifier
            Task { @MainActor in self.action?(actionID, id) }
        }
        completionHandler()
    }
}

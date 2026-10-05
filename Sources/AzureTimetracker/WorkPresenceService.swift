import AppKit
import CoreGraphics

/// Samples elapsed input idle time and the foreground app identity, never keys or window contents.
@MainActor final class WorkPresenceService: NSObject {
    private var unavailable: [String: Date] = [:]
    private var task: Task<Void, Never>?
    var changed: (() -> Void)?
    var unavailableSince: Date? { unavailable.values.min() }
    var reason: String { unavailable["lock"] != nil ? "Screen locked" : "Mac asleep or session inactive" }
    var idleSeconds: Double { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .init(rawValue: ~UInt32(0))!) }
    var foregroundApp: NSRunningApplication? { NSWorkspace.shared.frontmostApplication }
    func start() {
        guard task == nil else { return }
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            center.addObserver(self, selector: #selector(becameUnavailable(_:)), name: name, object: nil)
        }
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            center.addObserver(self, selector: #selector(becameAvailable(_:)), name: name, object: nil)
        }
        // macOS distributes lock events separately from user-session switching.
        // Supplement them with sleep/session notifications and an optional session-state read.
        let distributed = DistributedNotificationCenter.default()
        distributed.addObserver(self, selector: #selector(locked), name: .init("com.apple.screenIsLocked"), object: nil)
        distributed.addObserver(self, selector: #selector(unlocked), name: .init("com.apple.screenIsUnlocked"), object: nil)
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if let session = CGSessionCopyCurrentDictionary() as? [String: Any], let locked = session["CGSSessionScreenIsLocked"] as? Bool {
                    if locked { if unavailable["lock"] == nil { unavailable["lock"] = Date() } }
                    else { unavailable["lock"] = nil }
                }
                changed?()
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
            }
        }
    }
    @objc private func locked() { unavailable["lock"] = unavailable["lock"] ?? Date(); changed?() }
    @objc private func unlocked() { unavailable["lock"] = nil; changed?() }
    @objc private func becameUnavailable(_ note: Notification) {
        let key = note.name == NSWorkspace.willSleepNotification ? "sleep" : note.name == NSWorkspace.screensDidSleepNotification ? "display" : "session"
        unavailable[key] = unavailable[key] ?? Date(); changed?()
    }
    @objc private func becameAvailable(_ note: Notification) {
        let key = note.name == NSWorkspace.didWakeNotification ? "sleep" : note.name == NSWorkspace.screensDidWakeNotification ? "display" : "session"
        unavailable[key] = nil; changed?()
    }
}

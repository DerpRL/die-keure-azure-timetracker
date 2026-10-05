import Foundation

public struct WorkAwarenessPreferences: Codable, Equatable, Sendable {
    public var idleEnabled = true
    public var lockEnabled = true
    public var idleMinutes = 5
    public var forgottenEnabled = true
    public var forgottenMinutes = 10
    public var workAppIDs = ["com.microsoft.VSCode", "com.apple.Terminal", "com.googlecode.iterm2", "com.todesktop.230313mzl4w4u92", "com.openai.codex", "com.apple.dt.Xcode"]
    public init() {}
    public var isValid: Bool { (1...120).contains(idleMinutes) && (1...120).contains(forgottenMinutes) }
    public func watches(_ bundleID: String?) -> Bool { bundleID.map { workAppIDs.contains($0) } ?? false }
}

public struct IdleTrackingSession: Codable, Equatable, Sendable {
    public var identity: String
    public var workLogID: String
    public var title: String
    public var start: Date
    public init?(state: TrackingState?, confirmedAt: Date? = nil) {
        guard let state, state.running, let track = state.track, let id = track.workLogId?.nonEmpty else { return nil }
        let start: Date
        if let text = track.currentTrackStartedDateTime, let parsed = WireDate.parse(text, localIfUnspecified: true) { start = parsed }
        else if let confirmedAt, let seconds = track.currentTrackLength, seconds.isFinite, seconds >= 0, seconds <= Double(Int32.max) {
            start = confirmedAt.addingTimeInterval(-seconds)
        } else { return nil }
        identity = state.identity; workLogID = id; title = track.title; self.start = start
    }
}
public struct IdlePeriod: Codable, Equatable, Identifiable, Sendable {
    public var id = UUID()
    public var session: IdleTrackingSession
    public var start: Date
    public var end: Date?
    public var reason: String
    public var seconds: Double { max(0, (end ?? start).timeIntervalSince(start)) }
}

/// Consumes only elapsed idle time and lock/sleep state. It never changes a remote timer.
public struct IdleMonitor: Codable, Equatable, Sendable {
    public private(set) var away: IdlePeriod?
    public private(set) var pending: IdlePeriod?
    public init() {}
    public mutating func reconcile(_ session: IdleTrackingSession?) {
        if away?.session.identity != session?.identity { away = nil }
        if pending?.session.identity != session?.identity { pending = nil }
    }
    public mutating func observe(now: Date, idleSeconds: Double, unavailableSince: Date?, reason: String,
                                 session: IdleTrackingSession?, preferences: WorkAwarenessPreferences, meeting: Bool) {
        reconcile(session)
        guard let session, preferences.isValid, preferences.idleEnabled || preferences.lockEnabled else { away = nil; pending = nil; return }
        guard idleSeconds.isFinite, idleSeconds >= 0 else { return }
        // Keep an already detected absence intact; microphone use only suppresses passive idle detection.
        let locked = preferences.lockEnabled && unavailableSince != nil
        let inactive = preferences.idleEnabled && idleSeconds >= Double(preferences.idleMinutes * 60) && !meeting
        if locked || inactive {
            guard pending == nil, away == nil else { return }
            let boundary = locked ? unavailableSince! : now.addingTimeInterval(-idleSeconds)
            away = IdlePeriod(session: session, start: max(session.start, boundary), reason: locked ? reason : "No keyboard or mouse activity")
        } else if var period = away, unavailableSince == nil, idleSeconds < 30 {
            // Last input marks the return; do not count the delay until the next sample as idle.
            period.end = max(period.start, now.addingTimeInterval(-idleSeconds))
            away = nil
            if period.seconds >= 1 { pending = period }
        }
    }
    public mutating func dismiss() { pending = nil; away = nil }
}

public struct ForgottenReminder: Equatable, Identifiable, Sendable {
    public let id = UUID()
    public let since: Date
    public let appName: String
}
public struct ForgottenDeferral: Codable, Equatable, Sendable {
    public var until: Date?
    public var ignoredDay: Date?
    public init() {}
    public func suppresses(_ now: Date, calendar: Calendar = .current) -> Bool {
        (until.map { now < $0 } ?? false) || (ignoredDay.map { calendar.isDate($0, inSameDayAs: now) } ?? false)
    }
}
public struct ForgottenTimerMonitor: Sendable {
    public private(set) var pending: ForgottenReminder?
    private var since: Date?
    private var lastSample: Date?
    public init() {}
    public mutating func reset() { pending = nil; since = nil; lastSample = nil }
    public mutating func observe(now: Date, eligible: Bool, appName: String, minutes: Int, deferral: ForgottenDeferral) {
        guard eligible, (1...120).contains(minutes), !deferral.suppresses(now) else { reset(); return }
        // Sleep, stalled sampling or a clock change cannot count as active work.
        if let lastSample, now.timeIntervalSince(lastSample) > 15 || now < lastSample { reset() }
        if since == nil { since = now }
        lastSample = now
        if pending == nil, let since, now.timeIntervalSince(since) >= Double(minutes * 60) {
            pending = ForgottenReminder(since: since, appName: appName)
        }
    }
}

public struct WorkAwarenessLedger: Codable, Equatable, Sendable {
    public var workspace = ""
    public var idle = IdleMonitor()
    public var correction: IdlePeriod?
    public var deferral = ForgottenDeferral()
    public init() {}
    public mutating func scope(to workspace: String) {
        if self.workspace != workspace { self = Self(); self.workspace = workspace }
    }
}

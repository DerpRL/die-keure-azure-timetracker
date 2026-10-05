import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct WorkAwarenessTests {
    let now = localDate("2026-09-28T10:00:00")
    func session(id: String = "one") throws -> IdleTrackingSession {
        let object: [String: Any] = ["track": ["trackingState": "tracking", "workLogId": id, "tfsId": 123, "currentTrackStartedDateTime": "2026-09-28T09:00:00"]]
        return try #require(IdleTrackingSession(state: JSONDecoder().decode(TrackingState.self, from: JSONSerialization.data(withJSONObject: object))))
    }
    @Test func inactivityUsesLastInputAndPromptsOnlyOnReturn() throws {
        var monitor = IdleMonitor(); let session = try session(), prefs = WorkAwarenessPreferences()
        monitor.observe(now: now, idleSeconds: 299, unavailableSince: nil, reason: "", session: session, preferences: prefs, meeting: false)
        #expect(monitor.away == nil)
        monitor.observe(now: now, idleSeconds: 600, unavailableSince: nil, reason: "", session: session, preferences: prefs, meeting: false)
        #expect(monitor.away?.start == now.addingTimeInterval(-600)); #expect(monitor.pending == nil)
        monitor.observe(now: now.addingTimeInterval(60), idleSeconds: 2, unavailableSince: nil, reason: "", session: session, preferences: prefs, meeting: false)
        #expect(monitor.pending?.seconds == 658); #expect(monitor.away == nil)
        let prompt = monitor.pending
        monitor.observe(now: now.addingTimeInterval(62), idleSeconds: 1, unavailableSince: nil, reason: "", session: session, preferences: prefs, meeting: false)
        #expect(monitor.pending == prompt)
        monitor.dismiss(); #expect(monitor.pending == nil)
    }
    @Test func lockPromptsEvenBelowIdleThresholdAndDoesNotEndUntilUnlocked() throws {
        var monitor = IdleMonitor(), prefs = WorkAwarenessPreferences(); prefs.idleEnabled = false
        let session = try session()
        monitor.observe(now: now, idleSeconds: 0, unavailableSince: now, reason: "Screen locked", session: session, preferences: prefs, meeting: true)
        monitor.observe(now: now.addingTimeInterval(10), idleSeconds: 0, unavailableSince: now, reason: "Screen locked", session: session, preferences: prefs, meeting: true)
        #expect(monitor.pending == nil)
        monitor.observe(now: now.addingTimeInterval(12), idleSeconds: 0, unavailableSince: nil, reason: "", session: session, preferences: prefs, meeting: true)
        #expect(monitor.pending?.seconds == 12 && monitor.pending?.reason == "Screen locked")
    }
    @Test func meetingSuppressesPassiveIdleAndDisabledFeaturesClearEvidence() throws {
        var monitor = IdleMonitor(), prefs = WorkAwarenessPreferences(); let session = try session()
        monitor.observe(now: now, idleSeconds: 600, unavailableSince: nil, reason: "", session: session, preferences: prefs, meeting: true)
        #expect(monitor.away == nil)
        monitor.observe(now: now, idleSeconds: 600, unavailableSince: nil, reason: "", session: session, preferences: prefs, meeting: false)
        prefs.idleEnabled = false; prefs.lockEnabled = false
        monitor.observe(now: now, idleSeconds: 0, unavailableSince: nil, reason: "", session: session, preferences: prefs, meeting: false)
        #expect(monitor.away == nil && monitor.pending == nil)
    }
    @Test func changedTimerDiscardsIdleEvidenceAndStartIsClamped() throws {
        var monitor = IdleMonitor(); let original = try session(), other = try session(id: "other")
        monitor.observe(now: now, idleSeconds: 10000, unavailableSince: nil, reason: "", session: original, preferences: .init(), meeting: false)
        #expect(monitor.away?.start == original.start)
        monitor.reconcile(other); #expect(monitor.away == nil)
    }
    @Test func pendingAndSleepEvidenceSurviveRestartButWorkspaceChangesClearIt() throws {
        var ledger = WorkAwarenessLedger(); ledger.scope(to: "first")
        ledger.idle.observe(now: now, idleSeconds: 0, unavailableSince: now, reason: "Sleep", session: try session(), preferences: .init(), meeting: false)
        var restored = try JSONDecoder().decode(WorkAwarenessLedger.self, from: JSONEncoder().encode(ledger))
        #expect(restored == ledger)
        restored.idle.observe(now: now.addingTimeInterval(3600), idleSeconds: 1, unavailableSince: nil, reason: "", session: try session(), preferences: .init(), meeting: false)
        #expect(restored.idle.pending?.seconds == 3599)
        restored.scope(to: "second"); #expect(restored.idle.pending == nil)
    }
    @Test func forgottenRequiresContinuousEligibleWorkAndResetsForInactivity() {
        var monitor = ForgottenTimerMonitor()
        for i in stride(from: 0, through: 60, by: 2) {
            monitor.observe(now: now.addingTimeInterval(Double(i)), eligible: true, appName: "Editor", minutes: 1, deferral: .init())
        }
        #expect(monitor.pending?.appName == "Editor")
        monitor.observe(now: now.addingTimeInterval(62), eligible: false, appName: "Editor", minutes: 1, deferral: .init())
        #expect(monitor.pending == nil)
    }
    @Test func sleepAndClockChangesDoNotCountAsWork() {
        var monitor = ForgottenTimerMonitor()
        for offset in [0.0, 3600, -3600] {
            monitor.observe(now: now.addingTimeInterval(offset), eligible: true, appName: "Editor", minutes: 1, deferral: .init())
            #expect(monitor.pending == nil)
        }
    }
    @Test func snoozeIgnoreTodayAndNextDayUseLocalCalendar() {
        var deferral = ForgottenDeferral(); deferral.until = now.addingTimeInterval(900)
        #expect(deferral.suppresses(now)); #expect(!deferral.suppresses(now.addingTimeInterval(901)))
        deferral.ignoredDay = now
        #expect(deferral.suppresses(now.addingTimeInterval(3600)))
        #expect(!deferral.suppresses(Calendar.current.date(byAdding: .day, value: 1, to: now)!))
    }
    @Test func missingStartUsesConfirmedDurationWithoutExtrapolating() throws {
        let tracking = try JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":"tracking","workLogId":"one","currentTrackLength":600}}"#.utf8))
        #expect(IdleTrackingSession(state: tracking) == nil)
        #expect(IdleTrackingSession(state: tracking, confirmedAt: now)?.start == now.addingTimeInterval(-600))
        let noID = try JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":"tracking","currentTrackLength":600}}"#.utf8))
        #expect(IdleTrackingSession(state: noID, confirmedAt: now) == nil)
    }
    @Test func oldConfigurationDecodesDefaults() throws {
        let data = try JSONEncoder().encode(Configuration())
        let config = try JSONDecoder().decode(Configuration.self, from: data)
        #expect(config.awareness.idleMinutes == 5 && config.awareness.forgottenMinutes == 10)
        #expect(config.awareness.watches("com.microsoft.VSCode")); #expect(!config.awareness.watches("com.apple.Safari"))
    }
}

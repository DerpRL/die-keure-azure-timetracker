import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct MicrophoneTests {
    let app = MicrophoneOwner(id: "com.tinyspeck.slackmacgap", name: "Slack")
    let date = Date(timeIntervalSince1970: 1_000_000)
    func sample(_ engine: inout MicrophoneMeetingEngine, _ seconds: Int, active: Bool = true) {
        engine.sample(active ? [app] : [], at: date.addingTimeInterval(Double(seconds)))
    }
    @Test func shortUseDoesNotSuggestAndSustainedUseSuggestsOnce() {
        var engine = MicrophoneMeetingEngine()
        sample(&engine, 0); sample(&engine, 2)
        #expect(engine.suggestions().isEmpty)
        sample(&engine, 4)
        #expect(engine.suggestions().count == 1)
        sample(&engine, 6)
        #expect(engine.suggestions().isEmpty)
        #expect(engine.sessions.count == 1)
    }
    @Test func shortInterruptionDoesNotSplitMeeting() throws {
        var engine = MicrophoneMeetingEngine()
        for second in stride(from: 0, through: 6, by: 2) { sample(&engine, second) }
        let session = try #require(engine.suggestions().first)
        for second in stride(from: 8, through: 50, by: 2) { sample(&engine, second, active: false) }
        sample(&engine, 52)
        #expect(engine.isActive(session)); #expect(engine.ended.isEmpty); #expect(engine.suggestions().isEmpty)
    }
    @Test func confirmedAbsenceEndsEpisodeAndNextUseIsNew() throws {
        var engine = MicrophoneMeetingEngine()
        for second in stride(from: 0, through: 6, by: 2) { sample(&engine, second) }
        let session = try #require(engine.suggestions().first)
        for second in stride(from: 8, through: 68, by: 2) { sample(&engine, second, active: false) }
        #expect(!engine.isActive(session)); #expect(engine.ended.contains(session.id))
        for second in stride(from: 70, through: 76, by: 2) { sample(&engine, second) }
        #expect(engine.suggestions().first?.id != session.id)
        #expect(engine.sessions.count == 1)
    }
    @Test func missingSamplesAndSleepCannotProveEnd() throws {
        var engine = MicrophoneMeetingEngine()
        for second in stride(from: 0, through: 6, by: 2) { sample(&engine, second) }
        let session = try #require(engine.suggestions().first)
        for second in stride(from: 8, through: 64, by: 2) { sample(&engine, second, active: false) }
        engine.sample(nil, at: date.addingTimeInterval(66))
        sample(&engine, 68, active: false)
        sample(&engine, 1000, active: false)
        #expect(engine.isActive(session)); #expect(engine.ended.isEmpty)
    }
    @Test func failedAndInterruptedSamplesResetStartDebounce() {
        var engine = MicrophoneMeetingEngine()
        sample(&engine, 0); engine.sample(nil, at: date.addingTimeInterval(2)); sample(&engine, 4)
        #expect(engine.suggestions().isEmpty)
        sample(&engine, 100)
        #expect(engine.suggestions().isEmpty)
        sample(&engine, 102); sample(&engine, 104)
        #expect(engine.suggestions().count == 1)
    }
    @Test func multipleHelpersDoNotProduceDuplicateSessions() {
        var engine = MicrophoneMeetingEngine()
        engine.sample([app, app], at: date)
        engine.sample([app, app], at: date.addingTimeInterval(4))
        #expect(engine.suggestions().count == 1)
    }
    @Test func restoredMeetingWaitsForConfirmedAbsenceWithoutRepeatingSuggestion() {
        var engine = MicrophoneMeetingEngine()
        let session = MicrophoneSession(id: "restored", owner: app, started: date)
        engine.restore(session)
        #expect(engine.suggestions().isEmpty)
        for second in stride(from: 0, through: 58, by: 2) { sample(&engine, second, active: false) }
        #expect(engine.isActive(session))
        sample(&engine, 60, active: false)
        #expect(engine.ended.contains(session.id))
    }
    @Test func applicationCategoriesUseBoundariesAndSupportBrowsers() {
        #expect(MicrophoneApp.classify("com.microsoft.teams2") == .teams)
        #expect(MicrophoneApp.classify("com.google.Chrome.helper") == .browsers)
        #expect(MicrophoneApp.classify("com.apple.Safari") == .browsers)
        #expect(MicrophoneApp.classify("com.apple.WebKit.GPU") == .browsers)
        #expect(MicrophoneApp.classify("us.zoom.xos") == .zoom)
        #expect(MicrophoneApp.classify("com.tinyspeck.slackmacgap.fake") == .slack)
        #expect(MicrophoneApp.classify("com.microsoft.teamsunexpected") == .other)
        #expect(!MicrophonePreferences(enabled: true).apps.contains(.other))
    }
    @Test func requestedMeetingAppsAreEnabledByDefaultWithoutChangingSavedPreferences() throws {
        let defaults = MicrophonePreferences()
        #expect(defaults.enabled && defaults.apps == [.slack, .teams, .zoom, .browsers])
        #expect(MicrophoneApp.browsers.label.contains("Google Meet"))
        let old = try JSONDecoder().decode(MicrophonePreferences.self, from: Data(#"{"enabled":false,"apps":["Slack","Discord"]}"#.utf8))
        #expect(!old.enabled && old.apps == [.slack, .discord])
        var settings = Configuration(); settings.microphone = old
        #expect(try JSONDecoder().decode(Configuration.self, from: JSONEncoder().encode(settings)).microphone == old)
    }
    @Test func legacySlackSettingsMigrateWithoutRequiringIDsOrTokens() throws {
        var old = Configuration(); var slack = SlackPreferences(); slack.enabled = true
        old.slack = slack
        let data = try JSONEncoder().encode(old)
        var decoded = try JSONDecoder().decode(Configuration.self, from: data)
        #expect(decoded.microphone.enabled)
        decoded.microphone = MicrophonePreferences(enabled: false)
        #expect(!decoded.microphone.enabled)
        #expect(Configuration().microphone.enabled)
    }
}

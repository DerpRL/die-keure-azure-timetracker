import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct SlackHuddleTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func engine(joined: Bool = true, seen: [String: Date] = [:]) -> HuddleEngine {
        HuddleEngine(teamID: "TTEAM01", userID: "UUSER01", channels: ["CCHAN01"], onlyWhenJoined: joined, seen: seen)
    }
    func room(channel: String = "CCHAN01", ended: Bool = false, changed: Bool = false, team: String = "TTEAM01", stamp: Double = 1_800_000_000) throws -> Data {
        let message: [String: Any] = ["type": "message", "subtype": "huddle_thread", "room": ["id": "RCALL01", "date_start": now.timeIntervalSince1970, "date_end": ended ? now.timeIntervalSince1970 + 60 : 0, "has_ended": ended]]
        var event: [String: Any] = changed ? ["type": "message", "subtype": "message_changed", "message": message] : message
        event["channel"] = channel; event["event_ts"] = String(stamp)
        return try JSONSerialization.data(withJSONObject: ["team_id": team, "event": event])
    }
    @Test func onlyJoinedHuddlesInConfiguredChannelsProduceSuggestions() throws {
        var e = engine()
        e.consume(payload: try room(), now: now)
        #expect(e.suggestions(now: now).isEmpty)
        e.profile(state: "in_a_huddle", callID: "ROTHER1", timestamp: now.timeIntervalSince1970)
        #expect(e.suggestions(now: now).isEmpty)
        e.profile(state: "in_a_huddle", callID: "RCALL01", timestamp: now.timeIntervalSince1970 + 1)
        #expect(e.suggestions(now: now).map(\.id) == ["RCALL01"])
        #expect(e.suggestions(now: now).isEmpty)
    }
    @Test func joinsCanArriveBeforeRoomAndDuplicatesSurviveRestart() throws {
        var e = engine()
        e.profile(state: "in_a_huddle", callID: "RCALL01", timestamp: now.timeIntervalSince1970)
        e.consume(payload: try room(), now: now)
        #expect(e.suggestions(now: now).count == 1)
        var restored = engine(seen: try JSONDecoder().decode([String: Date].self, from: JSONEncoder().encode(e.seen)))
        restored.profile(state: "in_a_huddle", callID: "RCALL01", timestamp: now.timeIntervalSince1970)
        restored.consume(payload: try room(), now: now)
        #expect(restored.suggestions(now: now).isEmpty)
    }
    @Test func otherWorkspaceChannelAndOrdinaryMessagesAreIgnored() throws {
        var e = engine(joined: false)
        e.consume(payload: try room(channel: "COTHER1"), now: now)
        e.consume(payload: try room(team: "TOTHER1"), now: now)
        e.consume(payload: Data(#"{"team_id":"TTEAM01","event":{"type":"message","channel":"CCHAN01","text":"daily standup started"}}"#.utf8), now: now)
        #expect(e.suggestions(now: now).isEmpty)
    }
    @Test func endUpdatesInvalidateSuggestionsAndLateStartsCannotReopenThem() throws {
        var e = engine(joined: false)
        e.consume(payload: try room(), now: now)
        let huddle = try #require(e.suggestions(now: now).first)
        e.consume(payload: try room(ended: true, changed: true, stamp: now.timeIntervalSince1970 + 60), now: now.addingTimeInterval(60))
        #expect(!e.isActive(huddle, now: now))
        e.consume(payload: try room(), now: now)
        #expect(e.rooms.isEmpty)
    }
    @Test func ownDepartureIsConfirmedButUnknownOrOlderProfilesAreNot() throws {
        var e = engine()
        e.profile(state: "in_a_huddle", callID: "RCALL01", timestamp: 100)
        e.profile(state: nil, callID: nil, timestamp: 101)
        e.profile(state: "new_unknown_state", callID: nil, timestamp: 102)
        e.profile(state: "default_unset", callID: nil, timestamp: 99)
        #expect(!e.ended.contains("RCALL01"))
        e.profile(state: "default_unset", callID: nil, timestamp: 103)
        #expect(e.ended.contains("RCALL01")); #expect(e.currentCallID == nil)
    }
    @Test func channelStartModeHasGraceAndJoinedModeRequiresPresence() throws {
        var old = engine(joined: false)
        old.consume(payload: try room(), now: now.addingTimeInterval(301))
        #expect(old.suggestions(now: now.addingTimeInterval(301)).isEmpty)
        var current = engine(joined: false)
        current.consume(payload: try room(), now: now)
        #expect(current.suggestions(now: now).count == 1)
    }
    @Test func preferencesAcceptIDsAndLinksWithoutGuessingNames() throws {
        var prefs = SlackPreferences()
        prefs.channels = "CCHAN01, https://example.slack.com/archives/GCHAN02"
        #expect(try prefs.channelIDs() == ["CCHAN01", "GCHAN02"])
        prefs.channels = "#daily-standup"
        #expect(throws: (any Error).self) { try prefs.channelIDs() }
        prefs.channels = "https://slack.com.evil.test/archives/CCHAN01"
        #expect(throws: (any Error).self) { try prefs.channelIDs() }
    }
    @Test func socketAddressIsRestrictedToSlackTLS() throws {
        #expect(try SlackAPI.checkedSocketURL("wss://wss-primary.slack.com/link/?ticket=fixture").host == "wss-primary.slack.com")
        for bad in ["ws://wss.slack.com", "wss://slack.com.evil.test", "wss://attacker.test", "wss://user@wss.slack.com"] {
            #expect(throws: (any Error).self) { try SlackAPI.checkedSocketURL(bad) }
        }
    }
    @Test func onlyStandupActivityMatches() throws {
        let activities = try JSONDecoder().decode([ActivityType].self, from: Data(#"[{"id":"dev","name":"Development"},{"id":"meeting","name":"Overleg"},{"id":"standup","name":"Stand-up"}]"#.utf8))
        #expect(StandupActivity.selected(in: activities) == "standup")
        #expect(StandupActivity.selected(in: Array(activities.prefix(2))) == nil)
        #expect(StandupActivity.remark == "daily standup")
    }
    @Test func noTicketTrackingPreservesExactActivityAndComment() async throws {
        let old = try state(123), stub = try StubTracker(initial: old, stopped: state())
        let started = try await TrackingTransaction.switchTo(nil, expectedIdentity: old.identity, activityType: "standup", remark: "daily standup", service: stub)
        #expect(started.running); #expect(started.track?.ticketID == nil)
        #expect(started.track?.activityTypeId == "standup")
        #expect(started.track?.remark == "daily standup")
        #expect(await stub.calls == ["current", "stop", "start:unassigned"])
    }
    @Test func emptyUnassignedTrackingIsRejectedBeforeNetwork() async throws {
        let old = try state(), stub = StubTracker(initial: old, stopped: old)
        await #expect(throws: (any Error).self) { try await TrackingTransaction.switchTo(nil, expectedIdentity: old.identity, activityType: "standup", remark: nil, service: stub) }
        #expect(await stub.calls.isEmpty)
    }
    @Test func standupPauseRoundTripPreservesCommentWithoutFakeTicket() throws {
        let paused = PausedSession(ticketID: nil, activityID: "standup", workspace: "org", pausedAt: now, elapsedSeconds: 120, remark: "daily standup")
        #expect(try JSONDecoder().decode(PausedSession.self, from: JSONEncoder().encode(paused)) == paused)
    }
}

extension SlackHuddleTests {
    func history(ended: Bool = false) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["messages": [["subtype": "huddle_thread", "room": ["id": "RCALL01", "date_start": now.timeIntervalSince1970, "date_end": ended ? now.timeIntervalSince1970 + 20 : 0, "has_ended": ended, "channels": ["CCHAN01"]]]]])
    }
    @Test func historyRecoversHuddleWhenSocketEventWasMissed() throws {
        var e = engine(joined: false)
        e.consumeHistory(try history(), channel: "CCHAN01", observedAt: now)
        #expect(e.suggestions(now: now).map(\.id) == ["RCALL01"])
        #expect(e.suggestions(now: now).isEmpty)
        e.consumeHistory(try history(ended: true), channel: "CCHAN01", observedAt: now.addingTimeInterval(20))
        #expect(e.ended.contains("RCALL01") && e.rooms.isEmpty)
        e.consumeHistory(try history(), channel: "CCHAN01", observedAt: now.addingTimeInterval(30))
        #expect(e.rooms.isEmpty)
    }
    @Test func historyStillRequiresPresenceWhenJoinedOnlyIsSelected() throws {
        var e = engine()
        e.consumeHistory(try history(), channel: "CCHAN01", observedAt: now)
        #expect(e.suggestions(now: now).isEmpty)
        e.profile(state: "in_a_huddle", callID: "RCALL01", timestamp: now.timeIntervalSince1970)
        #expect(e.suggestions(now: now).count == 1)
    }
    @Test func historyRejectsUnconfiguredChannelsAndStaleConfirmations() throws {
        var e = engine(joined: false)
        e.consumeHistory(try history(), channel: "COTHER1", observedAt: now)
        #expect(e.rooms.isEmpty)
        e.consumeHistory(try history(), channel: "CCHAN01", observedAt: now)
        let h = try #require(e.rooms["RCALL01"])
        #expect(!e.isActive(h, now: now.addingTimeInterval(91)))
        #expect(!e.ended.contains(h.id)) // Loss of confirmation is not proof of an end.
        e.consumeHistory(try history(), channel: "CCHAN01", observedAt: now.addingTimeInterval(95))
        #expect(e.isActive(h, now: now.addingTimeInterval(95)))
    }
    @Test func historyCannotOverrideNewerLiveEndOrProfile() throws {
        var e = engine(joined: false)
        e.consume(payload: try room(ended: true, stamp: now.timeIntervalSince1970 + 20), now: now.addingTimeInterval(20))
        e.consumeHistory(try history(), channel: "CCHAN01", observedAt: now)
        #expect(e.rooms.isEmpty)
    }
    @Test func huddleRoomChannelMetadataHandlesMissingOuterChannel() throws {
        var e = engine(joined: false)
        let payload = try JSONSerialization.data(withJSONObject: ["team_id": "TTEAM01", "event": ["type": "message", "subtype": "huddle_thread", "event_ts": now.timeIntervalSince1970, "room": ["id": "RCALL01", "date_start": now.timeIntervalSince1970, "date_end": 0, "channels": ["CCHAN01"]]]])
        e.consume(payload: payload, now: now)
        #expect(e.suggestions(now: now).count == 1)
    }
}

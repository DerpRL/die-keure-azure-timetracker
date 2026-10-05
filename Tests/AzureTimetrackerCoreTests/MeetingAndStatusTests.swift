import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct MeetingSuggestionTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func meeting(_ id: String = "occurrence", offset: Double = 0) -> MeetingEvent {
        MeetingEvent(id: id, title: "Daily stand-up", start: now.addingTimeInterval(offset), end: now.addingTimeInterval(offset + 1800))
    }

    @Test func startsOnceAndSurvivesRestart() throws {
        var engine = MeetingSuggestionEngine()
        let event = meeting()
        #expect(engine.due(events: [event, event], now: now) == [event])
        #expect(engine.due(events: [event], now: now.addingTimeInterval(2)).isEmpty)
        let saved = try JSONEncoder().encode(engine.seen)
        var restored = MeetingSuggestionEngine(seen: try JSONDecoder().decode([String: Date].self, from: saved))
        #expect(restored.due(events: [event], now: now.addingTimeInterval(30)).isEmpty)
    }

    @Test func doesNotPromptBeforeStart() {
        var engine = MeetingSuggestionEngine()
        let event = meeting(offset: 30)
        #expect(engine.due(events: [event], now: now).isEmpty)
        #expect(engine.due(events: [event], now: event.start) == [event])
    }

    @Test func gracePeriodAndExpiredEvents() {
        var engine = MeetingSuggestionEngine()
        let recent = meeting("recent", offset: -300)
        #expect(engine.due(events: [meeting("old", offset: -301), meeting("ended", offset: -1800), recent], now: now) == [recent])
    }

    @Test func ignoresNonMeetingTimeAndDeclinedInvitations() {
        var allDay = meeting("all-day"); allDay.allDay = true
        var cancelled = meeting("cancelled"); cancelled.cancelled = true
        var declined = meeting("declined"); declined.declined = true
        var free = meeting("free"); free.free = true
        var engine = MeetingSuggestionEngine()
        #expect(engine.due(events: [allDay, cancelled, declined, free], now: now).isEmpty)
        #expect(engine.seen.isEmpty)
    }

    @Test func recurringOccurrencesAndOverlappingMeetingsRemainIndependent() {
        var engine = MeetingSuggestionEngine()
        let first = meeting("series-day1")
        let other = meeting("other", offset: -30)
        #expect(engine.due(events: [first, other], now: now) == [other, first])
        let tomorrow = meeting("series-day2", offset: 86400)
        #expect(engine.due(events: [tomorrow], now: tomorrow.start) == [tomorrow])
    }

    @Test func prunesOldReminderKeys() {
        var engine = MeetingSuggestionEngine(seen: ["old": now.addingTimeInterval(-172801), "recent": now.addingTimeInterval(-10)])
        _ = engine.due(events: [], now: now)
        #expect(engine.seen["old"] == nil)
        #expect(engine.seen["recent"] != nil)
    }

    @Test func calendarRemovalOrCancellationMakesEventInactive() {
        var event = meeting()
        #expect(event.isActive(at: now))
        event.cancelled = true
        #expect(!event.isActive(at: now))
        event.cancelled = false; event.end = now
        #expect(!event.isActive(at: now))
    }
}

@Suite struct MeetingTicketTests {
    @Test(arguments: ["Review #33984", "AB#33984 daily", "Discuss #33984."])
    func explicitTitleMarkers(_ title: String) {
        #expect(MeetingTicket.extract(title: title, url: nil, notes: nil, organization: "org") == 33984)
    }

    @Test(arguments: ["Stand-up 2026-09-29", "Review #33984 and #33981", "#0", "#2147483648", "#33.984", "Task #999999999999"])
    func ambiguousAndUnmarkedNumbersRequireManualSelection(_ title: String) {
        #expect(MeetingTicket.extract(title: title, url: nil, notes: "Meeting ID: 33984", organization: "org") == nil)
    }

    @Test func azureLinksUseTheConfiguredOrganization() {
        let link = URL(string: "https://dev.azure.com/org/Project/_workitems/edit/33984?view=edit")!
        #expect(MeetingTicket.extract(title: "Review", url: link, notes: nil, organization: "ORG") == 33984)
        #expect(MeetingTicket.extract(title: "Review", url: link, notes: nil, organization: "another-org") == nil)
        #expect(MeetingTicket.extract(title: "Review", url: URL(string: "https://dev.azure.com.evil.test/org/_workitems/edit/33984"), notes: nil, organization: "org") == nil)
    }

    @Test func notesLinksAndLegacyAzureHosts() {
        #expect(MeetingTicket.extract(title: "Review", url: nil, notes: "See (https://org.visualstudio.com/Project/_workitems/edit/33984).", organization: "org") == 33984)
        #expect(MeetingTicket.extract(title: "Review", url: nil, notes: "https://teams.microsoft.com/l/meetup-join/33984", organization: "org") == nil)
    }

    @Test func conflictingTitleAndURLAreNotGuessed() {
        let link = URL(string: "https://dev.azure.com/org/_workitems/edit/33981")!
        #expect(MeetingTicket.extract(title: "Review #33984", url: link, notes: nil, organization: "org") == nil)
    }

    @Test func oldSettingsStillDecode() throws {
        let old = #"{"organization":"org","project":"","sevenPaceURL":"","repositories":[],"branchPattern":"([0-9]+)","autoStartWhenIdle":false,"notificationsEnabled":true,"watchEnabled":true,"calendarEnabled":true,"selectedCalendarIDs":[],"activityTypeID":"dev","pollSeconds":60}"#
        var settings = try JSONDecoder().decode(Configuration.self, from: Data(old.utf8))
        #expect(settings.meetings.enabled)
        #expect(settings.meetings.defaultTicket.isEmpty)
        settings.meetings.defaultTicket = "33984"
        let restored = try JSONDecoder().decode(Configuration.self, from: JSONEncoder().encode(settings))
        #expect(restored.meetings.defaultTicket == "33984")
        #expect(restored.activityTypeID == "dev")
    }
}

@Suite struct MeetingActivityTests {
    let types = [ActivityType(id: "dev", name: "Development", color: nil), ActivityType(id: "meeting", name: "Overleg", color: nil), ActivityType(id: "daily", name: "Stand-up", color: nil)]
    @Test func suggestsMeetingActivitiesAndHonorsExplicitDefault() {
        #expect(MeetingActivity.suggestedID(title: "Team stand-up", preferredID: "", available: types) == "daily")
        #expect(MeetingActivity.suggestedID(title: "Daily scrum", preferredID: "", available: types) == "daily")
        #expect(MeetingActivity.suggestedID(title: "Planning", preferredID: "", available: types) == "meeting")
        #expect(MeetingActivity.suggestedID(title: "Stand-up", preferredID: "dev", available: types) == "dev")
    }
    @Test func missingOrRemovedActivityRequiresUserChoice() {
        #expect(MeetingActivity.suggestedID(title: "Planning", preferredID: "deleted", available: types) == nil)
        #expect(MeetingActivity.suggestedID(title: "Planning", preferredID: "", available: [types[0]]) == nil)
    }
}

@Suite struct TrackingIndicatorTests {
    @Test func pauseRequiresConfirmedIdleState() throws {
        #expect(TrackingIndicator.resolve(connected: true, connecting: false, state: try state(), paused: true) == .paused)
        #expect(TrackingIndicator.resolve(connected: true, connecting: false, state: try state(33984), paused: true) == .running)
        #expect(TrackingIndicator.resolve(connected: false, connecting: false, state: try state(), paused: true) == .disconnected)
        #expect(TrackingIndicator.resolve(connected: true, connecting: false, state: nil, paused: true) == .disconnected)
        #expect(TrackingIndicator.resolve(connected: true, connecting: true, state: try state(), paused: true) == .connecting)
    }
    @Test func pausedSessionPreservesTicketActivityAndWorkspaceAcrossRestart() throws {
        let paused = PausedSession(ticketID: 33984, activityID: "meeting", workspace: "https://org.timehub.7pace.com", pausedAt: Date(timeIntervalSince1970: 1_800_000_000), elapsedSeconds: 180)
        let restored = try JSONDecoder().decode(PausedSession.self, from: JSONEncoder().encode(paused))
        #expect(restored == paused)
    }
    @Test func runningStoppedAndDisconnectedAreDistinct() throws {
        #expect(TrackingIndicator.resolve(connected: true, connecting: false, state: try state(33984)) == .running)
        #expect(TrackingIndicator.resolve(connected: true, connecting: false, state: try state()) == .stopped)
        #expect(TrackingIndicator.resolve(connected: false, connecting: false, state: try state(33984)) == .disconnected)
        #expect(TrackingIndicator.resolve(connected: true, connecting: false, state: nil) == .disconnected)
        #expect(TrackingIndicator.resolve(connected: false, connecting: true, state: nil) == .connecting)
    }
    @Test func serverActivityCheckGetsAnAttentionIndicator() throws {
        let active = try JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":3,"tfsId":17,"activityCheck":{"isRunning":true}}}"#.utf8))
        #expect(TrackingIndicator.resolve(connected: true, connecting: false, state: active) == .attention)
        #expect(TrackingIndicator.resolve(connected: false, connecting: false, state: active) == .disconnected)
    }
    @Test func malformedRemoteStateIsNotShownAsStopped() throws {
        let unknown = try JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":"unknown"}}"#.utf8))
        #expect(TrackingIndicator.resolve(connected: true, connecting: false, state: unknown) == .disconnected)
    }
}

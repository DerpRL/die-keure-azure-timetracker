import SwiftUI
import AzureTimetrackerCore

struct DayReviewPrompt: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Review your day", systemImage: "checklist").font(.headline).accessibilityAddTraits(.isHeader)
            Text("Check your time entries and current timer before finishing.").font(.callout).foregroundStyle(palette.secondary)
            HStack {
                Button("Snooze 30 min") { model.snoozeDayReview() }.disabled(!model.canSnoozeDayReview)
                Spacer()
                Button { model.openDayReview() } label: { Label("Open review", systemImage: "arrow.right") }
                    .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white)
            }.controlSize(.large)
        }
    }
}

struct DayReviewView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var review: DayReviewModel
    private var summary: DayReviewSummary {
        .calculate(logs: review.logs, day: review.day, now: Date(), preferences: model.configuration.dayReview,
                   state: model.state, confirmedAt: model.lastSync, timerConfirmed: model.connectionHealth == .confirmed)
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                SectionTitle(title: "Day review", subtitle: "A final check of your time. You decide what needs attention.")
                Card {
                    HStack(spacing: 14) {
                        DatePicker("Review date", selection: $review.selectedDay, in: ...Date(), displayedComponents: .date)
                        Button("Today") { review.selectedDay = Date() }
                        Spacer()
                        Button { Task { await model.refreshDayReview() } } label: { Label("Refresh review", systemImage: "arrow.clockwise") }
                            .disabled(review.loading || !review.configured)
                    }
                }
                if let issue = review.issue {
                    Card {
                        VStack(alignment: .leading, spacing: 10) {
                        Label("Could not refresh worklogs", systemImage: "exclamationmark.triangle.fill").font(.headline).foregroundStyle(palette.warning)
                        Text(issue).font(.callout).textSelection(.enabled)
                        if review.loadedDay == review.day { Text("The entries below are from the last successful sync.").font(.callout) }
                        }
                    }
                }
                if review.loadedDay == review.day {
                    let data = summary
                    summarySection(data)
                    attentionSection(data)
                    entriesSection(data)
                    completionSection(data)
                    VStack(alignment: .leading, spacing: 7) {
                        if let sync = review.syncedAt { Label("Worklogs synced " + sync.formatted(date: .abbreviated, time: .shortened), systemImage: "arrow.clockwise") }
                        Text("Possible gaps use reported start times within your configured workday. Breaks may be intentional. Midnight entries or uncertain timer status hide gap estimates.")
                        Text("The review clips overnight entries to this day and counts the current timer only through its last confirmed duration. Nothing is edited or stopped automatically.")
                        if data.omittedLogs > 0 { Text("\(data.omittedLogs) entries have an invalid date or duration and need checking in 7pace.").foregroundStyle(palette.warning) }
                    }.font(.callout).foregroundStyle(palette.secondary)
                } else if review.loading {
                    Card { HStack(spacing: 12) { ProgressView().controlSize(.small); Text("Loading the day’s worklogs…") }.padding(.vertical, 30) }
                } else if review.issue == nil {
                    Card {
                        VStack(alignment: .leading, spacing: 16) {
                            EmptyState(symbol: "checklist", title: "Connect to review your day", detail: "Your review uses your own 7pace worklogs. Set up your account to get started.")
                            Button("Open Settings") { model.page = .settings }.buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white)
                        }
                    }
                }
            }.padding(28)
        }
        .task(id: review.day) { await review.load() }
        .onChange(of: review.connectionID) { _, _ in Task { await review.load() } }
    }
    private func summarySection(_ data: DayReviewSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            AppSectionHeading("Day at a glance", subtitle: review.day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
            HStack(spacing: 14) {
                reviewMetric("Tracked time", value: DurationText.short(data.totalSeconds), detail: "\(data.sessions.count) " + (data.sessions.count == 1 ? "entry" : "entries"), icon: "clock")
                reviewMetric("Daily target", value: DurationText.short(model.configuration.targets.dailySeconds(on: review.day, calendar: .current)), detail: "From your Settings", icon: "target")
                reviewMetric("Long entries", value: String(data.longSessions.count), detail: "\(model.configuration.dayReview.longSessionMinutes) minutes or more", icon: "clock.badge.exclamationmark")
            }
        }
    }
    private func reviewMetric(_ title: String, value: String, detail: String, icon: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                Label(title, systemImage: icon).font(.callout).foregroundStyle(palette.secondary)
                Text(value).font(.system(size: 25, weight: .bold, design: .rounded)).monospacedDigit()
                Text(detail).font(.callout).foregroundStyle(palette.secondary)
            }
        }
    }
    private func attentionSection(_ data: DayReviewSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            AppSectionHeading("Needs a look", subtitle: "Suggestions to review, not automatic corrections.")
            if data.timerRunning {
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("Your timer is still running", systemImage: "play.circle.fill").font(.headline).foregroundStyle(palette.warning)
                        Text(model.currentTicketTitle).font(.body)
                        HStack(spacing: 12) {
                            Button { Task { await model.pauseTracking(); await review.load(force: true) } } label: { Label("Pause tracking", systemImage: "pause.fill") }
                            Button { Task { await model.stopTracking(); await review.load(force: true) } } label: { Label("Stop tracking", systemImage: "stop.fill") }
                                .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white)
                        }.disabled(model.busy || model.connectionHealth != .confirmed)
                        Text("Marking the day reviewed will leave this timer running.").font(.callout).foregroundStyle(palette.secondary)
                    }
                }
            } else if data.timerUnconfirmed {
                Card { Label("Current timer status is unconfirmed. Reconnect or refresh before finishing.", systemImage: "exclamationmark.icloud").foregroundStyle(palette.warning) }
            }
            if !data.longSessions.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Long time entries", systemImage: "clock.badge.exclamationmark").font(.headline)
                        Text("Check whether these include a forgotten timer or an intentionally long session.").font(.callout).foregroundStyle(palette.secondary)
                        ForEach(data.longSessions) { session in sessionRow(session) }
                    }
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Possible gaps", systemImage: "rectangle.split.3x1").font(.headline)
                    if data.gapsUnavailable {
                        Text("A reliable gap estimate is unavailable for this day. Review the entries below and refresh if the connection is out of date.").foregroundStyle(palette.secondary)
                    } else if data.gaps.isEmpty {
                        Text("No gaps of \(model.configuration.dayReview.gapMinutes) minutes or longer in your configured workday so far.").foregroundStyle(palette.secondary)
                    } else {
                        Text(DurationText.short(data.gapSeconds) + " without a reported entry. Lunch, breaks and time off can explain these gaps.").foregroundStyle(palette.secondary)
                        ForEach(data.gaps) { gap in
                            HStack { Label(timeRange(gap.start, gap.end), systemImage: "clock"); Spacer(); Text(DurationText.short(gap.seconds)).monospacedDigit() }
                        }
                    }
                }.font(.callout)
            }
        }
    }
    private func entriesSection(_ data: DayReviewSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            AppSectionHeading("Time entries", subtitle: "Reported sessions, ordered by start time.")
            Card {
                VStack(alignment: .leading, spacing: 16) {
                    if data.sessions.isEmpty { Text("No entries recorded for this day.").foregroundStyle(palette.secondary) }
                    ForEach(data.sessions) { session in sessionRow(session); if session.id != data.sessions.last?.id { Divider() } }
                    Button("Review gaps & overlaps in Time editor…") {
                        model.timeEditor.day = review.day; model.page = .timeEditor
                        Task { await model.timeEditor.loadCorrections(preferences: model.configuration.dayReview) }
                    }.disabled(model.busy)
                    Button { model.showReviewHistory(review.day) } label: { Label("Open this day in History", systemImage: "clock.arrow.circlepath") }
                }
            }
        }
    }
    private func sessionRow(_ session: ReviewSession) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: session.isRunning ? "play.circle.fill" : "checkmark.circle").foregroundStyle(palette.accent).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(session.ticketID.map { "#" + String($0) + " · " + (model.workItems[$0]?.title ?? session.title) } ?? session.title).font(.body.weight(.medium))
                Text(timeRange(session.start, session.end) + " · " + session.activity + (session.isRunning ? " · running" : "")).font(.callout).foregroundStyle(palette.secondary)
            }
            Spacer()
            Text(DurationText.short(session.seconds)).font(.body.weight(.semibold)).monospacedDigit()
        }.accessibilityElement(children: .combine)
    }
    private func completionSection(_ data: DayReviewSummary) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                AppSectionHeading("Finish the review")
                if let reviewed = model.dayReviewRecord(for: review.day)?.reviewedAt {
                    Label("Reviewed " + reviewed.formatted(date: .abbreviated, time: .shortened), systemImage: "checkmark.seal.fill").foregroundStyle(palette.accent)
                } else {
                    HStack(spacing: 12) {
                        Button { model.markDayReviewed(review.day) } label: { Label("Mark day reviewed", systemImage: "checkmark") }
                            .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white)
                            .disabled(review.loading || review.issue != nil || model.preview)
                        if Calendar.current.isDateInToday(review.day), model.canSnoozeDayReview { Button("Remind me in 30 minutes") { model.snoozeDayReview() }.disabled(model.preview) }
                    }
                }
                Text("This saves a local review status. It does not submit a timesheet or change any worklog.").font(.callout).foregroundStyle(palette.secondary)
            }
        }
    }
    private func timeRange(_ start: Date, _ end: Date) -> String { start.formatted(date: .omitted, time: .shortened) + " – " + end.formatted(date: .omitted, time: .shortened) }
}

struct DayReviewSettings: View {
    @Environment(\.interfacePalette) private var palette

    @Binding var preferences: DayReviewPreferences
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            AppSectionHeading("End-of-day review", subtitle: "Choose when to check your time before you finish work.")
            Toggle("Remind me to review my day", isOn: $preferences.enabled)
            DatePicker("Workday starts", selection: timeBinding(\.startMinute), displayedComponents: .hourAndMinute)
            DatePicker("Review reminder / workday ends", selection: timeBinding(\.finishMinute), displayedComponents: .hourAndMinute)
            Text("Workday times define possible gaps. They do not start or stop tracking.").font(.callout).foregroundStyle(palette.secondary)
            Text("Review days").font(.headline)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), alignment: .leading)], alignment: .leading, spacing: 12) {
                ForEach([2, 3, 4, 5, 6, 7, 1], id: \.self) { day in
                    Toggle(Calendar.current.weekdaySymbols[day - 1], isOn: Binding(get: { preferences.weekdays.contains(day) }, set: { enabled in
                        if enabled { if !preferences.weekdays.contains(day) { preferences.weekdays.append(day) } }
                        else { preferences.weekdays.removeAll { $0 == day } }
                    })).toggleStyle(.checkbox)
                }
            }
            Divider()
            Stepper("Flag entries of \(preferences.longSessionMinutes) minutes or longer", value: $preferences.longSessionMinutes, in: 30...720, step: 30)
            Stepper("Show possible gaps of \(preferences.gapMinutes) minutes or longer", value: $preferences.gapMinutes, in: 5...180, step: 5)
            Text("A reminder appears once per day while the app is running, including if you open it later that evening. Snoozes and reviewed days survive restarts. macOS banners use your notification preference in App settings.")
                .font(.callout).foregroundStyle(palette.secondary)
        }
    }
    private func timeBinding(_ key: WritableKeyPath<DayReviewPreferences, Int>) -> Binding<Date> {
        Binding(get: { preferences.time(preferences[keyPath: key], on: Date()) }, set: { date in
            let c = Calendar.current.dateComponents([.hour, .minute], from: date)
            preferences[keyPath: key] = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        })
    }
}

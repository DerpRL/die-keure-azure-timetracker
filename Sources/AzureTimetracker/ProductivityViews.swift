import SwiftUI
import AzureTimetrackerCore

struct ConnectionHealthView: View {
    @ObservedObject var model: AppModel
    var compact = false
    @ViewState private var showDetails = false
    private var needsSetup: Bool { [.unconfigured, .authentication, .accessDenied].contains(model.connectionHealth) }
    private var hasDetailIssue: Bool { model.azureIssue != nil || model.progressIssue != nil || model.ticketCompletionIssue != nil }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Label(model.connectionHealth.label, systemImage: model.connectionHealth.symbol)
                    .foregroundStyle(model.connectionHealth == .confirmed || model.connectionHealth == .connecting ? Palette.accent : Palette.warning)
                    .font(.caption.weight(.medium))
                Spacer(minLength: 4)
                if needsSetup {
                    Button("Set up") { model.page = .settings; model.revealWindow?() }.font(.caption)
                } else if model.connectionHealth != .confirmed && model.connectionHealth != .connecting {
                    Button("Reconnect") { Task { await model.retryConnection() } }.disabled(model.busy).font(.caption)
                }
                Button("Details") { showDetails = true }.font(.caption).buttonStyle(.plain).foregroundStyle(Palette.accent)
                    .accessibilityLabel("7pace connection details")
                    .popover(isPresented: $showDetails) { ConnectionDetailsView(model: model).padding(20).frame(width: 370) }
            }
            if model.connectionHealth != .confirmed && model.connectionHealth != .connecting && model.connectionHealth != .unconfigured {
                Text("Showing the last known timer. Check 7pace before changing it.").font(.caption).foregroundStyle(Palette.warning)
            } else if hasDetailIssue {
                Button("Some details could not refresh") { showDetails = true }.buttonStyle(.plain).font(.caption).foregroundStyle(Palette.warning)
            }
            if compact { LocalDraftStatusView(model: model, offline: model.offlineDrafts) }
        }
    }
}

struct ConnectionDetailsView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Connection details", systemImage: "network").font(.headline)
            Text(model.connectionHealth.label).font(.callout.weight(.medium))
            if let sync = model.lastSync { Text("Timer checked " + sync.formatted(date: .abbreviated, time: .standard)) }
            else { Text("The timer has not been checked yet.") }
            if let sync = model.progressLastSync { Text("Time entries checked " + sync.formatted(date: .abbreviated, time: .standard)) }
            if let issue = model.connectionIssue { Text(issue).foregroundStyle(Palette.warning) }
            if let issue = model.azureIssue { Text("Azure tickets: " + issue).foregroundStyle(Palette.warning) }
            if let issue = model.progressIssue { Text("Time totals: " + issue).foregroundStyle(Palette.warning) }
            if let issue = model.ticketCompletionIssue { Text("Ticket completion check: " + issue).foregroundStyle(Palette.warning) }
            if let issue = model.shortcutIssue { Text(issue).foregroundStyle(Palette.warning) }
            if model.configuration.completionRemindersEnabled && !model.hasAzurePAT { Text("Add an Azure PAT in Accounts to enable ticket completion reminders.") }
            LocalDraftStatusView(model: model, offline: model.offlineDrafts)
            Button("Refresh connection") { Task { await model.retryConnection(); await model.checkTicketCompletion(force: true) } }.disabled(model.busy || model.preview)
        }.font(.caption).foregroundStyle(Palette.secondary).fixedSize(horizontal: false, vertical: true)
    }
}

struct TargetProgressView: View {
    @ObservedObject var model: AppModel
    var compact = false
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            VStack(alignment: .leading, spacing: compact ? 8 : 12) {
                if !compact { Label("Your time targets", systemImage: "scope").font(.headline) }
                if let progress = model.targetProgress(at: context.date) {
                    let targets = model.configuration.targets
                    let daily = targets.dailySeconds(on: context.date, calendar: .current)
                    progressRow("Today", seconds: progress.today, target: daily)
                    if let reason = targets.reason(on: context.date) { Text(reason).font(.caption).foregroundStyle(Palette.secondary) }
                    progressRow("This week", seconds: progress.week, target: targets.seconds(in: TargetProgress.weekInterval(at: context.date)))
                    if !compact {
                        Text("Monday–Sunday · daily targets from Settings · includes the identified current timer once")
                            .font(.caption).foregroundStyle(Palette.secondary)
                    }
                    if model.connectionHealth != .confirmed || model.progressIssue != nil {
                        Text("Last known totals · refresh to confirm").font(.caption).foregroundStyle(Palette.warning)
                    }
                } else {
                    Text(model.loadingProgress ? "Loading your time totals…" : "Time totals are unavailable until worklogs sync.")
                        .font(.caption).foregroundStyle(Palette.secondary)
                }
            }.padding(compact ? 0 : 18)
                .background(compact ? Color.clear : Palette.card, in: RoundedRectangle(cornerRadius: 14))
        }
    }
    private func progressRow(_ title: String, seconds: Double, target: Double) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.caption.weight(.medium))
                Spacer()
                Text(DurationText.short(seconds) + (target > 0 ? " / " + DurationText.short(target) : " · no target"))
                    .font(.caption).monospacedDigit()
            }
            if target > 0 {
                ProgressView(value: min(seconds / target, 1)).tint(Palette.accent)
                if !compact {
                    Text(seconds >= target ? "Target reached · " + DurationText.short(seconds - target) + " over" : DurationText.short(target - seconds) + " remaining")
                        .font(.caption).foregroundStyle(Palette.secondary)
                }
            }
        }
    }
}

struct MeetingReturnPrompt: View {
    @ObservedObject var model: AppModel
    var body: some View {
        if let plan = model.meetingReturn {
            VStack(alignment: .leading, spacing: 10) {
                Label(plan.microphoneSessionID == nil ? "Meeting ended" : "Microphone use stopped", systemImage: "arrow.uturn.backward.circle").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
                if plan.microphoneSessionID != nil { Text("You may have ended the call or muted your microphone. Keep tracking if the meeting is continuing.").font(.caption).foregroundStyle(Palette.secondary) }
                Text("Return to #\(String(plan.ticketID))?").font(.callout.weight(.semibold))
                if let item = model.workItems[plan.ticketID] { Text(item.title).font(.callout).lineLimit(2) }
                Text("Confirm the activity to resume your previous work.").font(.caption).foregroundStyle(Palette.secondary)
                HStack {
                    Button("Keep current") { model.dismissMeetingReturn() }.disabled(model.busy)
                    Spacer()
                    Button("Resume previous…") { model.returnAfterMeeting() }
                        .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white)
                        .disabled(model.busy || !model.connected)
                }
            }
        }
    }
}

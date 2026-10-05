import SwiftUI
import AzureTimetrackerCore

struct ConnectionHealthView: View {
    @ObservedObject var model: AppModel
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(model.connectionHealth.label, systemImage: model.connectionHealth.symbol)
                    .foregroundStyle(model.connectionHealth == .confirmed ? Palette.accent : Palette.warning)
                Spacer()
                Button("Retry") { Task { await model.retryConnection() } }.disabled(model.busy)
            }.font(compact ? .caption : .callout.weight(.medium))
            LocalDraftStatusView(model: model, offline: model.offlineDrafts)
            if let sync = model.lastSync {
                Text("Timer confirmed " + sync.formatted(date: .abbreviated, time: .standard))
                    .font(.caption).foregroundStyle(Palette.secondary)
            } else { Text("No timer status confirmed yet").font(.caption).foregroundStyle(Palette.secondary) }
            if model.connectionHealth != .confirmed {
                Text(model.connectionIssue ?? "The displayed timer is not currently confirmed by 7pace.")
                    .font(.caption).foregroundStyle(Palette.warning).fixedSize(horizontal: false, vertical: true)
            }
            if let issue = model.azureIssue {
                Text("Azure ticket lookup: " + issue).font(.caption).foregroundStyle(Palette.warning)
            }
            if !compact, let sync = model.progressLastSync {
                Text("Worklogs synced " + sync.formatted(date: .abbreviated, time: .standard))
                    .font(.caption).foregroundStyle(Palette.secondary)
            }
            if let issue = model.progressIssue {
                Text("Target totals could not refresh: " + issue).font(.caption).foregroundStyle(Palette.warning)
            }
            if let issue = model.shortcutIssue {
                Text(issue).font(.caption).foregroundStyle(Palette.warning)
            }
        }
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

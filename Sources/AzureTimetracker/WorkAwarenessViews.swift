import SwiftUI
import AppKit
import UniformTypeIdentifiers
import AzureTimetrackerCore

struct WorkAwarenessPrompts: View {
    @ObservedObject var model: AppModel
    var body: some View {
        if let prompt = model.workAwareness.idle.pending {
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Review time away", systemImage: "moon.zzz.fill").font(.headline).foregroundStyle(Palette.warning)
                    Text(prompt.session.title).font(.callout.weight(.semibold))
                    Text(prompt.reason + " · " + DurationText.short(prompt.seconds)).font(.callout)
                    Text(prompt.start.formatted(date: .omitted, time: .shortened) + " – " + (prompt.end ?? prompt.start).formatted(date: .omitted, time: .shortened)).monospacedDigit()
                    Text("Keep the recorded time, or pause now and preview removing or separating this interval. Nothing is edited until you save.").font(.callout).foregroundStyle(Palette.secondary)
                    ViewThatFits {
                        HStack { idleActions(prompt) }
                        VStack(alignment: .leading) { idleActions(prompt) }
                    }
                }
            }
        }
        if let pending = model.workAwareness.correction, model.workAwareness.idle.pending == nil {
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Saved idle-time review", systemImage: "clock.badge.exclamationmark").font(.headline)
                    Text("Review the detected interval before changing recorded time. Your timer may already be paused.").font(.callout).foregroundStyle(Palette.secondary)
                    Button("Open correction preview…") { Task { await model.openIdleCorrection(pending) } }.disabled(model.busy || !model.connected)
                    Button("Keep recorded time") { model.discardIdleCorrection() }.disabled(model.busy)
                }
            }
        }
        if let reminder = model.forgottenTimer.pending {
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Working without a timer?", systemImage: "timer").font(.headline).foregroundStyle(Palette.warning)
                    Text("You’ve been active in selected work apps, including " + reminder.appName + ", with no timer running.").font(.callout)
                    if !model.forgottenTickets.isEmpty {
                        Text("Tickets on your watched branches").font(.caption).foregroundStyle(Palette.secondary)
                        ForEach(Array(model.forgottenTickets.prefix(4).enumerated()), id: \.offset) { _, item in
                            Button(item.repository + " · #" + String(item.ticket)) {
                                Task { await model.chooseActivity(for: item.ticket, requiresIdle: true, inMenuBar: true) }
                            }.disabled(model.busy || !model.connected)
                        }
                    }
                    Button("Choose a ticket…") { model.beginMenuTracking(); model.revealSuggestion?() }.disabled(model.busy || !model.connected)
                    HStack {
                        Button("Snooze 15 min") { model.deferForgottenTimer(untilTomorrow: false) }
                        Button("Ignore today") { model.deferForgottenTimer(untilTomorrow: true) }
                    }
                    Text("Starting tracks from now. Use the Time editor to review earlier gaps.").font(.caption).foregroundStyle(Palette.secondary)
                }
            }
        }
    }
    @ViewBuilder private func idleActions(_ prompt: IdlePeriod) -> some View {
        Button("Keep time") { model.keepIdleTime() }.disabled(model.busy)
        Button("Pause & review…") { Task { await model.reviewIdleTime(prompt) } }
            .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white)
            .disabled(model.busy || model.connectionHealth != .confirmed || model.timeEditor.working)
    }
}

struct WorkAwarenessSettings: View {
    @Binding var preferences: WorkAwarenessPreferences
    @ViewState private var appIssue: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AppSectionHeading("Time awareness", subtitle: "Review suggestions before changing your timer or recorded time.")
            Toggle("Suggest reviewing time after inactivity", isOn: $preferences.idleEnabled)
            Stepper("Inactivity threshold: \(preferences.idleMinutes) minutes", value: $preferences.idleMinutes, in: 1...120)
                .disabled(!preferences.idleEnabled)
            Toggle("Detect screen lock, sleep and inactive sessions", isOn: $preferences.lockEnabled)
            Text("A prompt appears when you return. Reading without input may count as idle; detected meetings suppress passive inactivity prompts. Your timer keeps running until you choose an action.")
                .font(.callout).foregroundStyle(Palette.secondary)
            Divider()
            Toggle("Remind me when I work without a timer", isOn: $preferences.forgottenEnabled)
            Stepper("Remind after \(preferences.forgottenMinutes) active minutes", value: $preferences.forgottenMinutes, in: 1...120)
                .disabled(!preferences.forgottenEnabled)
            Text("Uses the workday start/end times in Day review and your scheduled working days. Paused tracking, detected meetings and a running offline draft suppress reminders.")
                .font(.callout).foregroundStyle(Palette.secondary)
            Text("Work applications").font(.headline)
            ForEach(preferences.workAppIDs, id: \.self) { id in
                HStack {
                    VStack(alignment: .leading) { Text(appName(id)); Text(NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) == nil ? "Not currently installed" : "Included in work detection").font(.caption).foregroundStyle(Palette.secondary) }
                    Spacer()
                    Button { preferences.workAppIDs.removeAll { $0 == id } } label: { Label("Remove", systemImage: "minus.circle") }
                        .accessibilityLabel("Remove " + appName(id) + " from work apps")
                }
            }
            Button("Add work application…") {
                let panel = NSOpenPanel(); panel.allowedContentTypes = [.applicationBundle]; panel.canChooseDirectories = false
                panel.directoryURL = URL(fileURLWithPath: "/Applications"); panel.allowsMultipleSelection = true
                if panel.runModal() == .OK {
                    for url in panel.urls {
                        guard let id = Bundle(url: url)?.bundleIdentifier else { appIssue = "An application has no bundle identifier."; continue }
                        if !preferences.workAppIDs.contains(id) { preferences.workAppIDs.append(id) }
                    }
                }
            }
            if let appIssue { Text(appIssue).foregroundStyle(Palette.warning) }
            Text("Only elapsed input inactivity and the foreground app’s identity are read. No keystrokes, window titles, documents or screenshots are collected. Lock events use macOS notifications with sleep/session fallback.")
                .font(.callout).foregroundStyle(Palette.secondary)
        }
    }
    private func appName(_ id: String) -> String {
        let names = ["com.microsoft.VSCode": "Visual Studio Code", "com.apple.Terminal": "Terminal", "com.googlecode.iterm2": "iTerm2", "com.todesktop.230313mzl4w4u92": "Cursor", "com.openai.codex": "Codex", "com.apple.dt.Xcode": "Xcode"]
        return names[id] ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: id)?.deletingPathExtension().lastPathComponent ?? id
    }
}

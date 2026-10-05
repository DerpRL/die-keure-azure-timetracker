import SwiftUI
import AzureTimetrackerCore

struct MicrophoneSettings: View {
    @Environment(\.interfacePalette) private var palette

    @Binding var preferences: MicrophonePreferences
    @ObservedObject var service: MicrophoneService
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Meeting detection", systemImage: "mic.fill").font(.headline)
            Toggle("Suggest tracking when an app uses my microphone", isOn: $preferences.enabled)
            Text("Select the apps to watch. Suggestions appear after 4 seconds of input use. Choose an activity and confirm before your timer changes.")
                .font(.callout).foregroundStyle(palette.secondary).fixedSize(horizontal: false, vertical: true)
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 10) {
                ForEach(MicrophoneApp.allCases) { app in
                    Toggle(app.label, isOn: Binding(get: { preferences.apps.contains(app) }, set: { if $0 { preferences.apps.insert(app) } else { preferences.apps.remove(app) } }))
                }
            }.disabled(!preferences.enabled)
            Text("Google Meet and other browser calls appear as Chrome, Safari, Edge, etc. Some appear as WebKit (browser or web view). Microphone use cannot identify a meeting, tab, Slack channel, or stand-up by itself. Dictation and recordings can also trigger a suggestion. Calls started while muted may not be detected until input becomes active.")
                .font(.caption).foregroundStyle(palette.secondary).fixedSize(horizontal: false, vertical: true)
            Text("After 60 seconds without microphone use in the selected apps, the app offers to pause or stop tracking, even if there is no previous ticket. Returning to previous work is also available when applicable. Muting can also cause this reminder; the timer only changes when you confirm.")
                .font(.caption).foregroundStyle(palette.secondary).fixedSize(horizontal: false, vertical: true)
            Divider()
            Label(service.status, systemImage: service.connected ? "checkmark.circle" : "info.circle").font(.callout)
            ForEach(service.owners) { owner in
                HStack {
                    Text(owner.name)
                    Spacer()
                    Text(preferences.apps.contains(owner.category) ? "Selected" : "Ignored").foregroundStyle(palette.secondary)
                }.font(.caption)
            }
            HStack {
                Button(service.checking ? "Checking…" : "Check now") { Task { await service.checkNow() } }.disabled(service.checking || !service.enabled)
                if let date = service.lastConfirmed { Text("Checked " + date.formatted(date: .omitted, time: .standard)).font(.caption).foregroundStyle(palette.secondary).fixedSize(horizontal: false, vertical: true) }
            }
            Text("Save changes to apply them. Requires macOS 14.2 or later. Reads local audio status only; no audio recording, Slack tokens, workspace IDs, or channel IDs.")
                .font(.caption).foregroundStyle(palette.secondary).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: 720, alignment: .leading)
    }
}
struct MicrophonePrompt: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    let microphoneSession: MicrophoneSession
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Microphone in use · possible meeting", systemImage: "mic.fill").font(.caption.weight(.semibold)).foregroundStyle(palette.accent)
            Text(microphoneSession.owner.name).font(.headline)
            Text("Track a meeting, or a daily standup with the Standup activity and comment ‘daily standup’. Both use no Azure ticket.").font(.caption).foregroundStyle(palette.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button(model.state?.running == true ? "Keep current" : "Dismiss") { model.dismissMicrophone(microphoneSession) }.disabled(model.busy)
                Spacer()
                Button("Meeting…") { Task { await model.chooseMicrophoneActivity(microphoneSession, standup: false) } }.disabled(model.busy || !model.connected)
                Button("Daily standup…") { Task { await model.chooseMicrophoneActivity(microphoneSession, standup: true) } }.disabled(model.busy || !model.connected)
            }
        }
    }
}

struct MicrophoneEndPromptView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    let prompt: MicrophoneEndPrompt
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Microphone use stopped", systemImage: "mic.slash.fill").font(.headline).foregroundStyle(palette.accent)
            Text(prompt.appNames.joined(separator: ", ") + " has not used the microphone for at least a minute. Has your meeting finished?")
                .font(.callout).fixedSize(horizontal: false, vertical: true)
            Text("Your timer is still running: " + model.currentTicketTitle).font(.callout.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            Text("If you only muted, keep tracking. Pause saves this task for resuming; Stop finishes tracking.").font(.caption).foregroundStyle(palette.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Keep tracking") { model.keepTrackingAfterMicrophone() }.disabled(model.busy)
                Spacer()
                Button("Pause") { Task { await model.pauseTracking(afterMicrophone: prompt) } }
                    .disabled(model.busy || !model.connected || model.preview)
                Button("Stop") { Task { await model.stopTracking(afterMicrophone: prompt) } }
                    .disabled(model.busy || !model.connected || model.preview)
            }
            if model.canReturnAfterMicrophone {
                Button("Resume previous ticket…") { model.returnAfterMeeting() }
                    .disabled(model.busy || !model.connected || model.preview)
            }
        }
    }
}

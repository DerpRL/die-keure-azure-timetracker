import SwiftUI
import AzureTimetrackerCore

typealias ViewFocus<Value: Hashable> = SwiftUI.FocusState<Value>

struct MenuTicketPicker: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ViewState<String> private var query = ""
    @ViewFocus<Bool> private var queryFocused
    private var choices: [WorkItem] {
        query.isEmpty ? model.quickTickets.orderedIDs.map { model.workItems[$0] ?? WorkItem(id: $0, title: "Azure ticket #\($0)") } : model.searchResults
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Quick switch").font(.headline); Spacer(); Text("⌃⌥T").font(.caption).foregroundStyle(palette.secondary) }
            if let meeting = model.selectedMeeting { Text("For \(meeting.title)").font(.caption).foregroundStyle(palette.secondary).lineLimit(2) }
            if model.hasSelectedSuggestion { SuggestionWithoutTicket(model: model, inMenuBar: true) }
            else { ManualTrackingChoices(model: model, inMenuBar: true) }
            HStack {
                TextField("Ticket number or title", text: $query).textFieldStyle(.roundedBorder).focused($queryFocused)
                    .onSubmit { Task { await model.search(query) } }
                Button("Search") { Task { await model.search(query) } }
                    .disabled(model.searching || model.busy || !model.connected || query.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if model.searching || model.busy { ProgressView().controlSize(.small) }
            if let error = model.searchError { Text(error).font(.caption).foregroundStyle(palette.warning) }
            if query.isEmpty && !choices.isEmpty { Text("Favorites & recent tickets").font(.caption).foregroundStyle(palette.secondary) }
            if !choices.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(choices) { item in
                            HStack {
                            Button {
                                Task { await model.chooseActivity(for: item.id, change: model.selectedChange, inMenuBar: true, meeting: model.selectedMeeting) }
                            } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("#\(String(item.id))").font(.caption.weight(.semibold)).foregroundStyle(palette.accent)
                                    Text(item.title).font(.callout).lineLimit(3).foregroundStyle(.primary)
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
                                    .background(palette.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
                                    .contentShape(Rectangle())
                            }.buttonStyle(.plain).disabled(model.busy || !model.connected)
                            Button { model.toggleFavorite(item.id) } label: {
                                Image(systemName: model.quickTickets.favorites.contains(item.id) ? "star.fill" : "star")
                                    .foregroundStyle(palette.accent).frame(width: 28, height: 28)
                            }.buttonStyle(.bordered).help(model.quickTickets.favorites.contains(item.id) ? "Remove favorite" : "Save favorite")
                                .accessibilityLabel((model.quickTickets.favorites.contains(item.id) ? "Remove favorite ticket #" : "Save favorite ticket #") + String(item.id))
                            }
                        }
                    }
                }.frame(height: 180)
            }
            Text("Next, choose the activity before starting.").font(.caption).foregroundStyle(palette.secondary)
            Button("Cancel") { model.cancelMenuTracking() }.keyboardShortcut(.cancelAction)
        }.onAppear {
            query = model.selectedMeeting.flatMap { model.meetingTicket($0) }.map(String.init)
                ?? model.selectedChange?.ticketID.map(String.init) ?? ""
        }.task { queryFocused = true }
    }
}

struct MenuActivityPicker: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    let draft: TrackingDraft
    @ViewState<String> private var activityID = ""
    @ViewState<String> private var comment = ""
    @ViewState private var includeTicket = true

    private var canStart: Bool { model.canStart(draft, activityID: activityID) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if draft.meetingReturn != nil { Label("Return to your previous work", systemImage: "arrow.uturn.backward").font(.caption).foregroundStyle(palette.secondary) }
            if let meeting = draft.meeting { Label(meeting.title, systemImage: "calendar").font(.caption).foregroundStyle(palette.secondary).lineLimit(2) }
            if includeTicket, let item = draft.item { Text("#\(String(item.id))").font(.caption.weight(.semibold)).foregroundStyle(palette.accent) }
            else { Text("No Azure ticket").font(.caption.weight(.semibold)).foregroundStyle(palette.accent) }
            if draft.manual == nil, let remark = draft.trackingComment(includeTicket: includeTicket) { Text("Comment: " + remark).font(.caption).foregroundStyle(palette.secondary) }
            Text(includeTicket ? draft.title : draft.remark ?? draft.title).font(.headline).fixedSize(horizontal: false, vertical: true)
            SuggestionTicketChoice(model: model, draft: draft, includeTicket: $includeTicket)
            if draft.standup && StandupActivity.selected(in: model.activityTypes) == nil && model.activityTypesLoaded {
                Text("The Standup activity is missing in 7pace. Add or enable it before tracking this stand-up.").font(.caption).foregroundStyle(palette.warning)
            }
            if model.loadingActivities {
                ProgressView("Loading activities…").controlSize(.small)
            } else if let error = model.activityError {
                Text(error).font(.caption).foregroundStyle(palette.warning)
                Button("Reload activities") { Task { await model.refreshActivities() } }
            } else if model.activityTypes.isEmpty {
                Text("7pace’s workspace default activity will be used.").font(.caption).foregroundStyle(palette.secondary)
            } else {
                Picker("Activity", selection: $activityID) {
                    Text("Choose an activity").tag("")
                    ForEach(model.activityTypes.filter { (!draft.standup || StandupActivity.matches($0)) && (!draft.isFigma || DesignActivity.matches($0)) }) { type in Text(type.name ?? type.id).tag(type.id) }
                }.pickerStyle(.menu)
            }
            if draft.isFigma { Button("Choose different work…") { model.chooseDifferentWork() }.disabled(model.busy) }
            if draft.isFigma { Text("The Figma file name is saved as the 7pace comment.").font(.caption).foregroundStyle(palette.secondary) }
            if draft.manual != nil { ManualTrackingComment(comment: $comment, kind: draft.manual!) }
            Text((draft.resume != nil || draft.meetingReturn != nil) ? "Resume starts a new session. Paused time is not logged." : model.state?.running == true ? "Your current timer continues until you press Start." : "The timer starts when you press Start.")
                .font(.caption).foregroundStyle(palette.secondary)
            if model.busy { ProgressView("Starting…").controlSize(.small) }
            HStack {
                Button("Cancel") { model.cancelMenuTracking() }.keyboardShortcut(.cancelAction).disabled(model.busy)
                Spacer()
                Button(draft.resume == nil && draft.meetingReturn == nil ? "Start" : "Resume") { Task { await model.startTracking(draft, activityID: activityID, comment: comment, includeTicket: includeTicket) } }
                    .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white).disabled(!canStart)
            }
        }
        .onAppear { selectDefault() }
        .onChange(of: model.activityTypes) { _, types in
            if !types.contains(where: { $0.id == activityID }) { selectDefault() }
        }
    }

    private func selectDefault() {
        let saved = model.preferredActivityID(for: draft)
        activityID = model.activityTypes.contains { $0.id == saved } ? saved : ""
    }
}

struct SuggestionWithoutTicket: View {
    @ObservedObject var model: AppModel
    var inMenuBar: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button("Continue without a ticket…") { Task { await model.chooseSuggestionWithoutTicket(inMenuBar: inMenuBar) } }
                .disabled(model.busy || !model.connected)
            Text(model.selectedFigmaSuggestion.map { "Design · " + $0.name } ?? "Choose an activity and confirm Start. An Azure ticket is optional.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct SuggestionTicketChoice: View {
    @ObservedObject var model: AppModel
    let draft: TrackingDraft
    @Binding var includeTicket: Bool
    var body: some View {
        if draft.allowsNoTicket {
            VStack(alignment: .leading, spacing: 6) {
                if let item = draft.item {
                    Toggle("Use Azure ticket #" + String(item.id), isOn: $includeTicket)
                    Text("Optional. Turn off to track only the activity and comment.").font(.caption).foregroundStyle(.secondary)
                }
                if draft.figmaFile == nil {
                    Button(draft.item == nil ? "Choose a ticket instead…" : "Choose another ticket…") { model.chooseSuggestionTicket(draft) }
                }
            }.disabled(model.busy)
        }
    }
}

struct ManualTrackingChoices: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    var inMenuBar: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Track without a ticket").font(.subheadline.weight(.semibold))
            HStack {
                ForEach([ManualTrackingKind.meeting, .standup, .activity]) { kind in
                    Button(kind.label) { Task { await model.chooseManualActivity(kind, inMenuBar: inMenuBar) } }
                        .disabled(model.busy || !model.connected)
                }
            }
            Text("Choose an activity. No ticket number or title needed.").font(.caption).foregroundStyle(palette.secondary)
        }
    }
}

struct ManualTrackingComment: View {
    @Environment(\.interfacePalette) private var palette

    @Binding var comment: String
    let kind: ManualTrackingKind
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Comment (optional)").font(.subheadline.weight(.medium))
            TextField(kind == .standup ? "daily standup" : kind == .meeting ? "Meeting" : "Defaults to the activity name", text: $comment)
                .textFieldStyle(.roundedBorder).accessibilityLabel("Tracking comment, optional")
            Text(kind == .standup ? "Leave blank to use daily standup." : "Leave blank to use the meeting or activity name.")
                .font(.caption).foregroundStyle(palette.secondary)
        }
    }
}

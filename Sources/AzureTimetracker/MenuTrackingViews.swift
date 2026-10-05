import SwiftUI
import AzureTimetrackerCore

typealias ViewFocus<Value: Hashable> = SwiftUI.FocusState<Value>

struct MenuTicketPicker: View {
    @ObservedObject var model: AppModel
    @ViewState<String> private var query = ""
    @ViewFocus<Bool> private var queryFocused
    private var choices: [WorkItem] {
        query.isEmpty ? model.quickTickets.orderedIDs.map { model.workItems[$0] ?? WorkItem(id: $0, title: "Azure ticket #\($0)") } : model.searchResults
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Quick switch").font(.headline); Spacer(); Text("⌃⌥T").font(.caption).foregroundStyle(Palette.secondary) }
            if let meeting = model.selectedMeeting { Text("For \(meeting.title)").font(.caption).foregroundStyle(Palette.secondary).lineLimit(2) }
            HStack {
                TextField("Ticket number or title", text: $query).textFieldStyle(.roundedBorder).focused($queryFocused)
                    .onSubmit { Task { await model.search(query) } }
                Button("Search") { Task { await model.search(query) } }
                    .disabled(model.searching || model.busy || !model.connected || query.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if model.searching || model.busy { ProgressView().controlSize(.small) }
            if let error = model.searchError { Text(error).font(.caption).foregroundStyle(Palette.warning) }
            if query.isEmpty && !choices.isEmpty { Text("Favorites & recent tickets").font(.caption).foregroundStyle(Palette.secondary) }
            if !choices.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(choices) { item in
                            HStack {
                            Button {
                                Task { await model.chooseActivity(for: item.id, change: model.selectedChange, inMenuBar: true, meeting: model.selectedMeeting) }
                            } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("#\(String(item.id))").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
                                    Text(item.title).font(.callout).lineLimit(3).foregroundStyle(.primary)
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
                                    .background(Palette.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
                                    .contentShape(Rectangle())
                            }.buttonStyle(.plain).disabled(model.busy || !model.connected)
                            Button { model.toggleFavorite(item.id) } label: {
                                Image(systemName: model.quickTickets.favorites.contains(item.id) ? "star.fill" : "star")
                                    .foregroundStyle(Palette.accent).frame(width: 28, height: 28)
                            }.buttonStyle(.bordered).help(model.quickTickets.favorites.contains(item.id) ? "Remove favorite" : "Save favorite")
                                .accessibilityLabel((model.quickTickets.favorites.contains(item.id) ? "Remove favorite ticket #" : "Save favorite ticket #") + String(item.id))
                            }
                        }
                    }
                }.frame(height: 180)
            }
            Text("Next, choose the activity before starting.").font(.caption).foregroundStyle(Palette.secondary)
            Button("Cancel") { model.cancelMenuTracking() }.keyboardShortcut(.cancelAction)
        }.onAppear {
            query = model.selectedMeeting.flatMap { model.meetingTicket($0) }.map(String.init)
                ?? model.selectedChange?.ticketID.map(String.init) ?? ""
        }.task { queryFocused = true }
    }
}

struct MenuActivityPicker: View {
    @ObservedObject var model: AppModel
    let draft: TrackingDraft
    @ViewState<String> private var activityID = ""

    private var canStart: Bool {
        model.activityTypesLoaded && !model.loadingActivities && !model.busy && model.connected &&
            (model.activityTypes.isEmpty || model.activityTypes.contains { $0.id == activityID }) &&
            (draft.microphoneSession == nil || (model.microphone.isActive(draft.microphoneSession!) && (!draft.standup || model.activityTypes.contains { $0.id == activityID && StandupActivity.matches($0) })))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if draft.meetingReturn != nil { Label("Return to your previous work", systemImage: "arrow.uturn.backward").font(.caption).foregroundStyle(Palette.secondary) }
            if let meeting = draft.meeting { Label(meeting.title, systemImage: "calendar").font(.caption).foregroundStyle(Palette.secondary).lineLimit(2) }
            if let item = draft.item { Text("#\(String(item.id))").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent) }
            else { Text("No Azure ticket").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent) }
            if let remark = draft.remark { Text("Comment: " + remark).font(.caption).foregroundStyle(Palette.secondary) }
            Text(draft.title).font(.headline).fixedSize(horizontal: false, vertical: true)
            if draft.meeting != nil {
                Button("Choose another ticket") { model.chooseDifferentMeetingTicket() }
                    .font(.caption).foregroundStyle(Palette.accent).disabled(model.busy)
            }
            if draft.standup && StandupActivity.selected(in: model.activityTypes) == nil && model.activityTypesLoaded {
                Text("The Standup activity is missing in 7pace. Add or enable it before tracking this stand-up.").font(.caption).foregroundStyle(Palette.warning)
            }
            if model.loadingActivities {
                ProgressView("Loading activities…").controlSize(.small)
            } else if let error = model.activityError {
                Text(error).font(.caption).foregroundStyle(Palette.warning)
                Button("Reload activities") { Task { await model.refreshActivities() } }
            } else if model.activityTypes.isEmpty {
                Text("7pace’s workspace default activity will be used.").font(.caption).foregroundStyle(Palette.secondary)
            } else {
                Picker("Activity", selection: $activityID) {
                    Text("Choose an activity").tag("")
                    ForEach(model.activityTypes.filter { !draft.standup || StandupActivity.matches($0) }) { type in Text(type.name ?? type.id).tag(type.id) }
                }.pickerStyle(.menu)
            }
            Text((draft.resume != nil || draft.meetingReturn != nil) ? "Resume starts a new session. Paused time is not logged." : model.state?.running == true ? "Your current timer continues until you press Start." : "The timer starts when you press Start.")
                .font(.caption).foregroundStyle(Palette.secondary)
            if model.busy { ProgressView("Starting…").controlSize(.small) }
            HStack {
                Button("Cancel") { model.cancelMenuTracking() }.keyboardShortcut(.cancelAction).disabled(model.busy)
                Spacer()
                Button(draft.resume == nil && draft.meetingReturn == nil ? "Start" : "Resume") { Task { await model.startTracking(draft, activityID: activityID) } }
                    .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(!canStart)
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

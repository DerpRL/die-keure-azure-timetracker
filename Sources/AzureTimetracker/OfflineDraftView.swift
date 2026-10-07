import SwiftUI
import AzureTimetrackerCore

struct OfflineDraftView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var offline: OfflineDraftModel
    @ViewState<OfflineDraft?> private var editing = nil
    @ViewState<OfflineDraft?> private var deleting = nil
    @ViewState private var showSynced = false
    @ViewState private var confirmRetry = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SectionTitle(title: "Offline drafts", subtitle: "Track locally, then review and upload when you reconnect.")
                SectionCard {
                    Text("Drafts stay on this Mac until you upload them. They are excluded from confirmed totals and statistics. A remote 7pace timer may still be running while you are offline.").foregroundStyle(palette.secondary)
                    HStack {
                        Button("Start local timer…") { editing = OfflineDraft(workspace: offline.workspace, ticketID: model.state?.track?.ticketID, activityID: model.configuration.activityTypeID.nonEmpty) }
                            .buttonStyle(.borderedProminent).tint(palette.action).disabled(!offline.canCreate || offline.active != nil)
                        Button("Add past time…") { editing = OfflineDraft(workspace: offline.workspace, start: Date().addingTimeInterval(-3600), end: Date()) }.disabled(!offline.canCreate)
                        Spacer()
                        Button("Reconnect") { Task { await model.retryConnection() } }.disabled(model.busy || offline.working)
                    }
                    if offline.workspace.isEmpty { Text("Save your 7pace workspace URL in Settings first. Credentials are only needed for uploading.").foregroundStyle(palette.warning) }
                    if let active = offline.active {
                        Divider()
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            HStack {
                                Label("Local timer · " + active.title, systemImage: "internaldrive")
                                Text(DurationText.clock(max(0, context.date.timeIntervalSince(active.start)))).font(.title2).monospacedDigit()
                                Spacer(); Button("Stop local timer") { offline.stop() }.disabled(offline.working)
                            }
                        }
                        if active.workspace != offline.workspace { Text("This timer belongs to " + active.workspace + ". Stop it here, then switch workspace to upload it.").font(.callout).foregroundStyle(palette.warning) }
                        Text("Time continues through sleep and restarts. Adjust it before uploading.").font(.caption).foregroundStyle(palette.secondary)
                    }
                }
                if let issue = offline.issue { SectionCard { Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(palette.warning).textSelection(.enabled) } }
                if let message = offline.message { Label(message, systemImage: "info.circle").foregroundStyle(palette.accent) }
                if offline.working { ProgressView("Checking with 7pace…") }
                if let review = offline.review { reviewCard(review) }
                HStack { Text("This workspace · \(offline.readyCount) awaiting review").font(.headline); Spacer(); Toggle("Show synced", isOn: $showSynced) }
                let drafts = offline.drafts.filter { showSynced || $0.status != .synced }
                if drafts.isEmpty { SectionCard { EmptyState(symbol: "internaldrive", title: "No offline drafts", detail: "Start a local timer or add time you worked while disconnected.") } }
                ForEach(drafts) { draft in draftRow(draft) }
            }.padding(28)
        }
        .sheet(item: $editing) { draft in
            InterfaceSheet(interface: model.interface) { OfflineDraftEditor(draft: draft, activities: offline.activities, offline: offline) { editing = nil } }
        }
        .confirmationDialog("Remove this local record? Entries already in 7pace will stay there.", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Remove local record", role: .destructive) { if let deleting { offline.remove(deleting) }; deleting = nil }
            Button("Cancel", role: .cancel) { deleting = nil }
        }
        .confirmationDialog("Only unlock this draft after checking 7pace and confirming that the upload did not create an entry.", isPresented: $confirmRetry) {
            Button("I checked 7pace — allow another review") { offline.allowRetryAfterManualCheck() }
            Button("Cancel", role: .cancel) {}
        }
    }
    private func draftRow(_ draft: OfflineDraft) -> some View {
        SectionCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(draft.ticketID.flatMap { model.workItems[$0]?.title }.map { draft.title + " · " + $0 } ?? draft.title).font(.headline)
                    Text(draft.start.formatted(date: .abbreviated, time: .shortened) + " → " + (draft.end?.formatted(date: .abbreviated, time: .shortened) ?? "Running locally")).font(.callout)
                    Text(draft.status.rawValue).font(.caption).foregroundStyle(draft.status == .sending ? palette.warning : palette.accent)
                    if let end = draft.end { Text(DurationText.clock(end.timeIntervalSince(draft.start))).monospacedDigit() }
                    if let remoteID = draft.remoteID { Text("7pace entry: " + remoteID).font(.caption).textSelection(.enabled) }
                }
                Spacer()
                if draft.status == .draft { Button("Edit") { editing = draft } }
                if !draft.running, draft.status != .synced { Button("Review") { Task { await offline.check(draft) } }.disabled(!offline.configured) }
                if draft.status != .sending { Button("Remove") { deleting = draft } }
            }.disabled(offline.working || model.busy)
        }
    }
    private func reviewCard(_ review: OfflineReview) -> some View {
        SectionCard {
            Text("Review " + review.draft.title).font(.headline)
            Text("Uploads belong to your currently signed-in 7pace account.").font(.caption).foregroundStyle(palette.secondary)
            Text("Activity: " + (offline.activities.first { $0.id == review.draft.activityID }?.name ?? "Choose an activity by editing this draft"))
            Text(review.draft.start.formatted(date: .abbreviated, time: .standard) + " → " + (review.draft.end?.formatted(date: .abbreviated, time: .standard) ?? "Running"))
                .font(.callout).monospacedDigit()
            Text((review.draft.billable ? "Billable" : "Non-billable") + " · " + DurationText.clock((review.draft.end ?? Date()).timeIntervalSince(review.draft.start))).font(.callout)
            Text(review.draft.comment).foregroundStyle(palette.secondary)
            if let issue = review.overlapIssue { Label("Overlap check incomplete: " + issue, systemImage: "exclamationmark.triangle").foregroundStyle(palette.warning) }
            if !review.conflicts.isEmpty {
                Label("Overlapping time · uploading is still allowed", systemImage: "exclamationmark.triangle.fill").foregroundStyle(palette.warning)
                ForEach(review.conflicts) { conflict in
                    Text(Self.conflictLine(conflict)).font(.callout)
                }
            } else if review.overlapIssue == nil { Label("No overlapping entries found", systemImage: "checkmark.circle").foregroundStyle(palette.accent) }
            if !review.matches.isEmpty {
                Text("Matching entries already exist. Link the correct entry to resolve this draft without adding more time.")
                ForEach(review.matches) { log in Button("Link existing entry " + log.id) { Task { await offline.link(log) } }.textSelection(.enabled) }
            } else if review.draft.status == .sending {
                Text("The previous upload may have reached 7pace. No matching entry was found. Check 7pace manually before allowing a retry.").foregroundStyle(palette.warning)
                Button("I checked 7pace…") { confirmRetry = true }
            } else {
                Button(review.conflicts.isEmpty && review.overlapIssue == nil ? "Upload draft to 7pace" : "Upload with overlap warning") {
                    Task { await offline.upload() }
                }.buttonStyle(.borderedProminent).tint(palette.action).disabled(model.preview)
            }
        }.disabled(offline.working || model.busy)
    }
    // Built outside the view builder with explicit types: compilers older than the release Mac's
    // Swift 6.4 (Xcode 26 in CI) give up type-checking the long `+` chain inline.
    private static func conflictLine(_ conflict: WorkLogConflict) -> String {
        let ticket: String = conflict.ticketID.map { "#" + String($0) + " · " } ?? ""
        let start: String = conflict.start.formatted(date: .abbreviated, time: .shortened)
        let end: String = conflict.end.formatted(date: .omitted, time: .shortened)
        let running: String = conflict.active ? " · timer running" : ""
        return ticket + "\(conflict.title) · \(start) → \(end) · \(DurationText.short(conflict.overlap))" + running
    }
}

private struct OfflineDraftEditor: View {
    @Environment(\.interfacePalette) private var palette

    @ViewState var draft: OfflineDraft
    let activities: [ActivityType]
    @ObservedObject var offline: OfflineDraftModel
    let close: () -> Void
    @ViewState private var ticket = ""
    @ViewState private var activity = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionTitle(title: draft.running ? "Local timer" : "Edit offline time", subtitle: "Saved on this Mac until you review and upload.")
            TextField("Azure ticket number (optional)", text: $ticket).textFieldStyle(.roundedBorder)
            TextField("Comment (required without a ticket)", text: $draft.comment).textFieldStyle(.roundedBorder)
            Picker("Activity", selection: $activity) {
                Text(activities.isEmpty ? "Choose after reconnecting" : "Choose an activity").tag("")
                ForEach(activities) { Text($0.name ?? $0.id).tag($0.id) }
                if !activity.isEmpty && !activities.contains(where: { $0.id == activity }) { Text("Previously selected activity").tag(activity) }
            }
            Text("Activities are cached for this workspace. Reconnect and review to refresh them.").font(.caption).foregroundStyle(palette.secondary)
            DatePicker("Start", selection: $draft.start, in: ...Date())
            if draft.end != nil { DatePicker("End", selection: Binding(get: { draft.end ?? Date() }, set: { draft.end = $0 }), in: ...Date()) }
            Toggle("Billable time", isOn: $draft.billable)
            if let issue = offline.issue { Text(issue).font(.callout).foregroundStyle(palette.warning) }
            HStack {
                Button("Cancel", action: close).keyboardShortcut(.cancelAction)
                Spacer()
                Button(draft.running ? "Save local timer" : "Save draft") {
                    draft.ticketID = Int(ticket.trimmingCharacters(in: .whitespacesAndNewlines)); draft.activityID = activity.nonEmpty
                    if offline.save(draft) { close() }
                }.buttonStyle(.borderedProminent).tint(palette.action).keyboardShortcut(.defaultAction)
                    .disabled(!validTicket || offline.working || (!activities.isEmpty && activity.isEmpty))
            }
        }.padding(28).frame(width: 590).onAppear { ticket = draft.ticketID.map(String.init) ?? ""; activity = draft.activityID ?? "" }
    }
    private var validTicket: Bool { let value = ticket.trimmingCharacters(in: .whitespacesAndNewlines); return value.isEmpty || Int(value).map { $0 > 0 && $0 <= Int32.max } == true }
}

struct LocalDraftStatusView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var offline: OfflineDraftModel
    var body: some View {
        if let active = offline.active {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                HStack {
                    Label("Local · " + DurationText.clock(max(0, context.date.timeIntervalSince(active.start))), systemImage: "internaldrive").monospacedDigit().foregroundStyle(palette.warning)
                    Spacer()
                    Button("Stop") { offline.stop() }.disabled(offline.working)
                    Button("Drafts") { model.page = .offlineDrafts; model.revealWindow?() }
                }.font(.caption)
            }
        } else if offline.readyCount > 0 || model.connectionHealth != .confirmed {
            Button(offline.readyCount > 0 ? "Review \(offline.readyCount) offline drafts" : "Track locally…") { model.page = .offlineDrafts; model.revealWindow?() }.font(.caption)
        }
    }
}

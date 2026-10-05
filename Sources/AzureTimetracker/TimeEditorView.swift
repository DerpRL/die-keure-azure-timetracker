import SwiftUI
import AzureTimetrackerCore

struct TimeEditorView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var editor: TimeEditorModel
    @ViewState private var showHistory = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                SectionTitle(title: "Time editor", subtitle: "Edit recorded time in 7pace. Overlap warnings are informational and do not block saving.")
                HStack {
                    DatePicker("Date", selection: $editor.day, in: ...Date(), displayedComponents: .date)
                        .accessibilityLabel("Worklog date")
                    TextField("Filter by ticket number or comment", text: $editor.filter).textFieldStyle(.roundedBorder)
                    Button { Task { await editor.load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                }.disabled(editor.working || editor.loading || model.busy)
                HStack {
                    Text("Select adjacent entries using the checkboxes or ⌘-click.").font(.callout).foregroundStyle(Palette.secondary)
                    Spacer()
                    Button("Merge selected…") { Task { await editor.beginMerge() } }.disabled(editor.selection.count < 2 || editor.working || model.busy)
                    Button("Gaps & overlaps…") { Task { await editor.loadCorrections(preferences: model.configuration.dayReview) } }
                        .disabled(editor.working || editor.loading || model.busy)
                    Button("Recent edits") { showHistory = true }
                }
                if editor.requiresReview { Label("An earlier change needs review. Open Recent edits before making another change.", systemImage: "exclamationmark.triangle.fill").foregroundStyle(Palette.warning) }
                if let issue = editor.journalIssue { Label(issue, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Palette.warning) }
            }.padding(.horizontal, 28).padding(.vertical, 20)
            Divider()
            timeTable
                .disabled(editor.loading)
                .overlay {
                    if editor.loading { ProgressView("Loading tracked time…").padding(24).background(Palette.background, in: RoundedRectangle(cornerRadius: 12)) }
                    else if editor.visibleLogs.isEmpty {
                        Text(editor.configured || model.preview ? "No entries match this date or filter." : "Connect to 7pace in Settings to edit your recorded time.")
                            .foregroundStyle(Palette.secondary).padding(32)
                    }
                }
            if editor.message != nil || editor.savedOverlapIssue != nil || !editor.savedConflicts.isEmpty || (editor.issue != nil && editor.selected == nil) {
                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    if let message = editor.message { Label(message, systemImage: "checkmark.circle.fill").foregroundStyle(Palette.accent) }
                    if !editor.savedConflicts.isEmpty || editor.savedOverlapIssue != nil {
                        DisclosureGroup {
                            ScrollView { overlapNotice(editor.savedConflicts, issue: editor.savedOverlapIssue, saved: true).frame(maxWidth: .infinity, alignment: .leading) }
                                .frame(maxHeight: 150)
                        } label: {
                            Label(editor.savedConflicts.isEmpty ? "Overlap check incomplete" : "Saved with overlapping time", systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(Palette.warning)
                        }
                    }
                    if editor.selected == nil, let issue = editor.issue { Label(issue, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Palette.warning).textSelection(.enabled) }
                }.padding(.horizontal, 28).padding(.vertical, 14)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .buttonStyle(.bordered).controlSize(.large)
        .sheet(isPresented: Binding(get: { editor.selected != nil || showHistory || editor.showCorrections }, set: { if !$0 { editor.cancel(); showHistory = false; editor.showCorrections = false } })) {
            if editor.showCorrections { TimeCorrectionReview(model: model, editor: editor).interactiveDismissDisabled(editor.working) }
            else if showHistory { recentEdits }
            else if let log = editor.selected {
                editSheet(log).interactiveDismissDisabled(editor.working || model.busy)
            }
        }
        .task(id: editor.connectionID) { if !model.preview { await editor.load() } }
        .onChange(of: editor.filter) { _, _ in editor.selection = [] }
        .onChange(of: editor.day) { _, _ in Task { await editor.load() } }
    }
    private var timeTable: some View {
        Table(editor.visibleLogs, selection: $editor.selection) {
            TableColumn("Select") { log in
                Toggle("Select entry", isOn: Binding(get: { editor.selection.contains(log.id) }, set: { value in
                    if value { editor.selection.insert(log.id) } else { editor.selection.remove(log.id) }
                })).toggleStyle(.checkbox).labelsHidden()
                    .accessibilityLabel("Select " + title(log) + " at " + (log.date?.formatted(date: .omitted, time: .shortened) ?? log.timestamp))
                    .disabled(editor.working || model.busy)
            }.width(50)
            TableColumn("Task") { log in
                if let id = log.workItemId, id > 0 {
                    Button { model.showContext(id) } label: { Text(title(log)).lineLimit(2) }
                        .buttonStyle(.plain).foregroundStyle(Palette.accent).help("Show ticket context")
                        .accessibilityLabel("Show context for " + title(log))
                } else { Text(title(log)).lineLimit(2) }
            }.width(min: 140, ideal: 190)
            TableColumn("Start") { log in
                timeCell(log.date, fallback: log.timestamp)
            }.width(min: 65, ideal: 70, max: 82)
            TableColumn("End") { log in
                timeCell(log.date.map { $0.addingTimeInterval(log.length) }, fallback: "Unknown")
            }.width(min: 65, ideal: 70, max: 82)
            TableColumn("Duration") { log in
                Text(DurationText.short(log.length)).monospacedDigit()
            }.width(min: 60, ideal: 70, max: 85)
            TableColumn("Activity") { log in
                Text(log.activityType?.name ?? "Default activity").lineLimit(2)
                    .help(log.activityType?.name ?? "Default activity")
            }.width(min: 80, ideal: 100, max: 140)
            TableColumn("Comment") { log in
                Text(log.comment?.nonEmpty ?? "—").lineLimit(2).help(log.comment ?? "No comment")
            }.width(min: 100, ideal: 160)
            TableColumn("Action") { log in
                if log.id == model.state?.track?.workLogId && model.state?.running == true {
                    Label("Running", systemImage: "play.circle").foregroundStyle(Palette.warning)
                } else if log.isCanEdit == false {
                    Label("Locked", systemImage: "lock").foregroundStyle(Palette.secondary).help("Locked by 7pace")
                } else {
                    Button("Edit") { Task { await editor.select(log) } }
                        .disabled(editor.working || model.busy).accessibilityLabel("Edit time for " + title(log))
                }
            }.width(90)
        }
        .controlSize(.regular)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel("Recorded time entries")
    }
    private func timeCell(_ date: Date?, fallback: String) -> some View {
        Text(date?.formatted(date: .omitted, time: .shortened) ?? fallback).monospacedDigit()
            .help(date?.formatted(date: .abbreviated, time: .standard) ?? fallback)
            .accessibilityLabel(date?.formatted(date: .abbreviated, time: .shortened) ?? fallback)
    }
    private func title(_ log: WorkLog) -> String {
        log.workItemId.flatMap { $0 > 0 ? $0 : nil }.map { "#\($0) · " + (model.workItems[$0]?.title ?? "Azure task") } ?? "No Azure ticket"
    }
    private var loadedConflicts: [WorkLogConflict] {
        guard let plan = try? editor.proposedPlan(), let state = model.state else { return [] }
        let ids = Set(plan.before.map(\.id)); var result: [String: WorkLogConflict] = [:]
        for draft in plan.desired {
            for conflict in (try? WorkLogOverlap.conflicts(edit: draft.edit, excluding: plan.before[0].id, logs: editor.logs.filter { !ids.contains($0.id) }, state: state)) ?? [] { result[conflict.id] = conflict }
        }
        return result.values.sorted { $0.start < $1.start }
    }
    private func overlapNotice(_ conflicts: [WorkLogConflict], issue: String?, saved: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !conflicts.isEmpty {
                Label(saved ? "Saved with overlapping time" : "Overlapping time", systemImage: "exclamationmark.triangle.fill")
                    .font(.headline).foregroundStyle(Palette.warning)
                ForEach(conflicts) { conflict in
                    VStack(alignment: .leading, spacing: 4) {
                        Text((conflict.ticketID.map { "#\($0) · " } ?? "") + conflict.title).font(.callout.weight(.semibold))
                        Text(conflict.start.formatted(date: .abbreviated, time: .shortened) + " → " + (conflict.active ? "still running" : conflict.end.formatted(date: .abbreviated, time: .shortened)) + " · " + DurationText.short(conflict.overlap) + " overlap")
                            .font(.callout).foregroundStyle(Palette.secondary)
                    }
                }
            }
            if let issue { Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning) }
            Text(saved ? (conflicts.isEmpty ? "Your changes were saved. Check nearby entries in 7pace if needed." : "Your changes were saved. Overlapping entries were kept.") : "Overlaps are informational. You can still save without extra confirmation.")
                .font(.callout).foregroundStyle(Palette.secondary)
        }.fixedSize(horizontal: false, vertical: true)
    }
    private var recentEdits: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack { SectionTitle(title: "Recent edits", subtitle: "Changes made on this Mac, for this 7pace workspace."); Spacer(); Button("Done") { showHistory = false }.keyboardShortcut(.cancelAction) }.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if editor.recentChanges.isEmpty { Text("Your confirmed edits, splits and merges will appear here.").foregroundStyle(Palette.secondary) }
                    ForEach(editor.recentChanges) { change in
                        Card {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text(change.title).font(.headline); Spacer()
                                    Text(change.date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(Palette.secondary)
                                }
                                Text(change.status == .complete ? "Ready to undo" : change.status == .undone ? "Undone" : change.status == .reviewed ? "Reviewed" : "Needs review")
                                    .foregroundStyle(change.status == .needsReview ? Palette.warning : Palette.accent)
                                Text(change.detail).font(.callout).textSelection(.enabled)
                                DisclosureGroup("Affected entries") {
                                    ForEach(change.before) { entry in
                                        Text((entry.workItemId.map { "#\($0) · " } ?? "") + entry.timestamp + " · " + DurationText.short(entry.length) + "\n" + entry.id).font(.caption).textSelection(.enabled)
                                    }
                                    ForEach(change.after.filter { after in !change.before.contains { $0.id == after.id } }) { entry in Text("Created: " + entry.id).font(.caption).textSelection(.enabled) }
                                }
                                DisclosureGroup("Planned result") {
                                    ForEach(Array(change.desired.enumerated()), id: \.offset) { _, draft in
                                        Text((draft.ticketID.map { "#\($0) · " } ?? "No Azure ticket · ") + draft.start.formatted(date: .abbreviated, time: .shortened) + " → " + draft.edit.end.formatted(date: .omitted, time: .shortened) + " · " + (draft.comment ?? ""))
                                            .font(.caption).textSelection(.enabled)
                                    }
                                }
                                if change.status == .complete {
                                    Button("Undo…") { editor.beginUndo(change); showHistory = false }.disabled(editor.requiresReview || editor.working || model.busy)
                                } else if change.status == .needsReview || change.status == .applying {
                                    Text("Compare the affected entries in 7pace before acknowledging. This acknowledgment does not undo or retry anything.").font(.caption).foregroundStyle(Palette.secondary)
                                    if let url = try? Endpoint.sevenPace(model.configuration.sevenPaceURL) { Link("Open 7pace", destination: url) }
                                    Button("I checked the entries in 7pace") { editor.acknowledge(change) }.disabled(editor.working || model.busy)
                                }
                            }
                        }
                    }
                }.padding(24)
            }
        }.frame(width: 780, height: 620).background(Palette.background).buttonStyle(.bordered).controlSize(.large)
    }
    private func editSheet(_ log: WorkLog) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(title: editor.mode.rawValue + " · recorded time", subtitle: title(log)).padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if editor.mode == .edit || editor.mode == .split {
                        Picker("Operation", selection: $editor.mode) {
                            Text("Edit time").tag(TimeEditMode.edit)
                            Text("Split entry").tag(TimeEditMode.split)
                        }.pickerStyle(.segmented)
                    }
                    if editor.mode == .guided, let interval = editor.idleInterval {
                        AppSectionHeading("Idle interval", subtitle: interval.start.formatted(date: .abbreviated, time: .shortened) + " → " + interval.end.formatted(date: .abbreviated, time: .shortened))
                        Picker("How to handle idle time", selection: $editor.separateIdle) {
                            Text("Remove idle time").tag(false)
                            Text("Separate into its own entry").tag(true)
                        }.pickerStyle(.segmented)
                        Text("Work before and after the interval stays recorded. The timer is paused; resume it when you are ready.").font(.callout).foregroundStyle(Palette.secondary)
                        if editor.separateIdle {
                            TextField("Ticket number (optional)", text: $editor.secondTicket).textFieldStyle(.roundedBorder)
                            TextField("Comment for the separate entry", text: $editor.secondComment).textFieldStyle(.roundedBorder)
                            Picker("Activity", selection: $editor.secondActivity) {
                                Text("7pace default").tag("")
                                if let originalID = log.activityType?.id, !model.activityTypes.contains(where: { $0.id == originalID }) {
                                    Text(log.activityType?.name ?? "Original activity").tag(originalID)
                                }
                                ForEach(model.activityTypes) { Text($0.name ?? "Activity").tag($0.id) }
                            }
                        }
                    }
                    if editor.mode == .edit {
                        HStack(spacing: 24) {
                            DatePicker("Start", selection: $editor.start, displayedComponents: [.date, .hourAndMinute])
                            DatePicker("End", selection: $editor.end, displayedComponents: [.date, .hourAndMinute])
                        }.disabled(editor.working || model.busy || editor.needsReload)
                    } else if editor.mode == .split {
                        DatePicker("Split at", selection: $editor.splitAt, displayedComponents: [.date, .hourAndMinute])
                        AppSectionHeading("Second entry", subtitle: "The first part keeps its original ticket and activity.")
                        LabeledContent("Ticket") { TextField("Azure ticket number (optional)", text: $editor.secondTicket).textFieldStyle(.roundedBorder) }
                        LabeledContent("Comment") { TextField("Comment", text: $editor.secondComment).textFieldStyle(.roundedBorder) }
                        Picker("Activity", selection: $editor.secondActivity) {
                            Text("Default activity").tag("")
                            if let originalID = log.activityType?.id, !model.activityTypes.contains(where: { $0.id == originalID }) {
                                Text(log.activityType?.name ?? "Original activity").tag(originalID)
                            }
                            ForEach(model.activityTypes) { activity in Text(activity.name ?? "Activity").tag(activity.id) }
                        }
                    }
                    if let plan = try? editor.proposedPlan() {
                        if editor.mode == .guided { CorrectionPlanPreview(plan: plan) }
                        AppSectionHeading("Result", subtitle: "Total: " + DurationText.short(Double(plan.desired.reduce(0) { $0 + $1.seconds })))
                        ForEach(Array(plan.desired.enumerated()), id: \.offset) { _, draft in
                            VStack(alignment: .leading, spacing: 4) {
                                Text((draft.ticketID.map { "#\($0)" } ?? "No Azure ticket") + " · " + DurationText.short(Double(draft.seconds))).font(.headline)
                                Text(draft.start.formatted(date: .abbreviated, time: .shortened) + " → " + draft.edit.end.formatted(date: .abbreviated, time: .shortened)).font(.callout)
                                Text("Billable: " + DurationText.short(Double(draft.billableSeconds))).font(.caption).foregroundStyle(Palette.secondary)
                            }
                        }
                        if editor.mode == .merge { Text("The first entry is extended and the other selected entries are removed. Total recorded and billable time stay the same.").font(.callout).foregroundStyle(Palette.secondary) }
                        if editor.mode == .undo { Text("Restores the previous values after checking for newer changes. Removed entries are recreated with new IDs; their original server audit timestamps cannot be restored.").font(.callout).foregroundStyle(Palette.secondary) }
                    }
                    if let issue = editor.validationIssue {
                        Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning)
                    } else if let review = editor.review {
                        Divider()
                        if review.conflicts.isEmpty && review.overlapIssue == nil {
                            Label("No overlapping entries found", systemImage: "checkmark.circle").foregroundStyle(Palette.accent)
                        } else { overlapNotice(review.conflicts, issue: review.overlapIssue) }
                    } else if !loadedConflicts.isEmpty {
                        Divider()
                        overlapNotice(loadedConflicts, issue: nil)
                    }
                    Text("Overlaps are checked again when saving. Check overlaps is optional and also includes entries from other dates.")
                        .font(.callout).foregroundStyle(Palette.secondary)
                    if let issue = editor.issue { Label(issue, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Palette.warning).textSelection(.enabled) }
                    if editor.working || model.busy { ProgressView("Checking 7pace…") }
                }.disabled(editor.working || model.busy || editor.needsReload).padding(24).frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack(spacing: 12) {
                Button("Cancel edit") { editor.cancel() }.keyboardShortcut(.cancelAction).disabled(editor.working || model.busy)
                if editor.needsReload {
                    Button("Reload entry") { Task { await editor.select(log) } }.disabled(editor.working || model.busy)
                }
                Spacer()
                Button("Check overlaps") { Task { await editor.checkChanges() } }
                    .disabled(model.busy || editor.working || editor.needsReload || editor.validationIssue != nil)
                Button(editor.mode == .guided ? "Apply correction" : editor.mode == .edit ? "Save time changes" : editor.mode == .split ? "Split entry" : editor.mode == .merge ? "Merge entries" : "Undo change") { Task { await model.saveTimeEdit() } }
                    .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).keyboardShortcut(.defaultAction)
                    .disabled(model.preview || model.busy || editor.working || editor.needsReload || editor.requiresReview || editor.journalIssue != nil || editor.validationIssue != nil)
            }.padding(24)
        }
        .frame(width: 780, height: 620)
        .background(Palette.background)
        .buttonStyle(.bordered).controlSize(.large)
    }

}

struct TrackingAttentionPrompt: View {
    @ObservedObject var model: AppModel
    let prompt: TrackingAttention
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(prompt.heading, systemImage: "clock.badge.exclamationmark").font(.headline).foregroundStyle(Palette.warning)
            Text((prompt.ticketID.map { "#\($0) · " } ?? "") + (prompt.ticketID.flatMap { model.workItems[$0]?.title } ?? prompt.title))
                .font(.callout.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            Text(prompt.detail).font(.callout).foregroundStyle(Palette.secondary)
            HStack {
                Button(prompt.stopped ? "Keep stopped" : "Stop tracking") {
                    if prompt.stopped { model.keepAttentionStopped() }
                    else { Task { await model.stopTracking() } }
                }
                Spacer()
                Button(prompt.stopped ? "Continue…" : "Continue tracking") { Task { await model.continueTrackingAttention() } }
                    .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white)
            }.disabled(model.busy || !model.connected)
        }
    }
}

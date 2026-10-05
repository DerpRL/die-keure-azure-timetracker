import SwiftUI
import AzureTimetrackerCore

struct TimeCorrectionReview: View {
    @ObservedObject var model: AppModel
    @ObservedObject var editor: TimeEditorModel
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                SectionTitle(title: "Gaps & overlaps", subtitle: editor.day.formatted(date: .complete, time: .omitted))
                Spacer()
                Button("Done") { editor.showCorrections = false }.keyboardShortcut(.cancelAction).disabled(editor.working)
            }.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Gaps may be lunch, breaks or leave. Choose only the corrections you want; each action opens a preview and can be undone after saving.").foregroundStyle(Palette.secondary)
                    if editor.correctionLoading { ProgressView("Checking recorded time…") }
                    if let issue = editor.correctionIssue { Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning) }
                    if !editor.correctionLoading, editor.correctionIssue == nil, editor.correctionIssues.isEmpty {
                        Label("No gaps or overlaps found in the elapsed workday.", systemImage: "checkmark.circle").foregroundStyle(Palette.accent)
                        Text("Gaps use the minimum duration configured in Day review. A day without entries has no neighboring task to extend.").font(.callout).foregroundStyle(Palette.secondary)
                    }
                    ForEach(editor.correctionIssues) { issue in
                        CorrectionIssueCard(issue: issue, model: model, editor: editor)
                    }
                }.padding(24)
            }
            Divider()
            HStack {
                Button("Refresh review") { Task { await editor.loadCorrections(preferences: model.configuration.dayReview) } }
                    .disabled(editor.correctionLoading || editor.working || model.busy)
                Spacer()
                Text("Overlap warnings still allow ordinary edits.").font(.caption).foregroundStyle(Palette.secondary)
            }.padding(24)
        }.frame(width: 800, height: 650).background(Palette.background).buttonStyle(.bordered).controlSize(.large)
    }
}

private struct CorrectionIssueCard: View {
    let issue: TimeCorrectionIssue
    @ObservedObject var model: AppModel
    @ObservedObject var editor: TimeEditorModel
    @ViewState private var boundary: Date
    init(issue: TimeCorrectionIssue, model: AppModel, editor: TimeEditorModel) {
        self.issue = issue; self.model = model; self.editor = editor
        _boundary = ViewState(initialValue: issue.start.addingTimeInterval(issue.seconds / 2))
    }
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Label((issue.kind == .gap ? "Possible gap · " : "Overlapping time · ") + DurationText.short(issue.seconds),
                      systemImage: issue.kind == .gap ? "clock.badge.questionmark" : "rectangle.on.rectangle")
                    .font(.headline).foregroundStyle(Palette.warning)
                Text(issue.start.formatted(date: .omitted, time: .shortened) + " – " + issue.end.formatted(date: .omitted, time: .shortened)).monospacedDigit()
                if let log = issue.earlier { Text("Earlier: " + title(log)).font(.callout) }
                if let log = issue.later { Text("Later: " + title(log)).font(.callout) }
                if issue.kind == .gap {
                    HStack {
                        option("Extend earlier task…", plan: try? TimeCorrections.fillGap(issue, usingEarlier: true))
                        option("Start later task earlier…", plan: try? TimeCorrections.fillGap(issue, usingEarlier: false))
                    }
                } else {
                    HStack {
                        option("Remove overlap from earlier…", plan: issue.earlier.flatMap { try? TimeCorrections.removeInterval($0, start: issue.start, end: issue.end) })
                        option("Remove overlap from later…", plan: issue.later.flatMap { try? TimeCorrections.removeInterval($0, start: issue.start, end: issue.end) })
                    }
                    HStack {
                        DatePicker("Shared boundary", selection: $boundary, in: issue.start...issue.end, displayedComponents: [.hourAndMinute])
                        option("Preview boundary…", plan: try? TimeCorrections.moveBoundary(issue, to: boundary))
                    }
                    Text("A trim keeps work before and after the overlap. A shared boundary assigns the first part to the earlier task and the rest to the later one. Options that would remove a whole entry are unavailable.")
                        .font(.caption).foregroundStyle(Palette.secondary)
                }
            }
        }
    }
    private func title(_ log: WorkLog) -> String {
        (log.workItemId.map { "#\($0) · " + (model.workItems[$0]?.title ?? "Azure task") } ?? log.comment ?? "Tracked time") + " · " + (log.activityType?.name ?? "Activity")
    }
    private func option(_ title: String, plan: WorkLogPlan?) -> some View {
        Button(title) { if let plan { Task { await editor.prepareCorrection(plan) } } }
            .disabled(plan == nil || editor.working || model.busy)
    }
}

struct CorrectionPlanPreview: View {
    let plan: WorkLogPlan
    private var lower: Date { (plan.before.compactMap(\.date) + plan.desired.map(\.start)).min() ?? Date() }
    private var upper: Date { (plan.before.compactMap { $0.date?.addingTimeInterval($0.length) } + plan.desired.map(\.edit.end)).max() ?? Date() }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            AppSectionHeading("Before → after", subtitle: "Review every affected interval before applying this correction.")
            Text("Before · " + DurationText.short(plan.before.reduce(0) { $0 + $1.length })).font(.headline)
            ForEach(plan.before) { log in
                if let start = log.date { row(start: start, end: start.addingTimeInterval(log.length), ticket: log.workItemId, comment: log.comment, color: Palette.warning) }
            }
            Divider()
            Text("After · " + DurationText.short(Double(plan.desired.reduce(0) { $0 + $1.seconds }))).font(.headline)
            ForEach(Array(plan.desired.enumerated()), id: \.offset) { _, draft in
                row(start: draft.start, end: draft.edit.end, ticket: draft.ticketID, comment: draft.comment, color: Palette.accent)
            }
            Text("You can undo this correction from Recent edits. Overlap warnings do not block saving.").font(.callout).foregroundStyle(Palette.secondary)
        }
    }
    private func row(start: Date, end: Date, ticket: Int?, comment: String?, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text((ticket.map { "#\($0) · " } ?? "") + (comment?.nonEmpty ?? "Tracked time")).font(.callout.weight(.medium))
            GeometryReader { geo in
                let duration = max(1, upper.timeIntervalSince(lower))
                RoundedRectangle(cornerRadius: 4).fill(color)
                    .frame(width: max(3, geo.size.width * end.timeIntervalSince(start) / duration))
                    .offset(x: geo.size.width * start.timeIntervalSince(lower) / duration)
            }.frame(height: 10).accessibilityHidden(true)
            Text(start.formatted(date: .abbreviated, time: .shortened) + " → " + end.formatted(date: .abbreviated, time: .shortened) + " · " + DurationText.short(end.timeIntervalSince(start)))
                .font(.caption).monospacedDigit()
        }.accessibilityElement(children: .combine)
    }
}

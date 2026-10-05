import SwiftUI
import Charts
import AzureTimetrackerCore

struct TicketContextView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var context: TicketContextModel
    let ticketID: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                SectionTitle(title: "Ticket context", subtitle: "#" + String(ticketID))
                Spacer()
                Button("Open in Azure") { model.openTicket(ticketID) }
                Button("Done") { model.contextRequest = nil }.keyboardShortcut(.cancelAction)
            }.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if context.loading { ProgressView("Loading ticket details…") }
                    if let issue = context.issue {
                        Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning)
                        Button("Retry") { Task { await context.load(ticketID) } }
                    }
                    if let details = context.details, details.id == ticketID {
                        Text(details.title).font(.title2.weight(.semibold)).textSelection(.enabled)
                        Card {
                            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 10) {
                                contextRow("Status", details.state); contextRow("Type", details.type); contextRow("Assigned to", details.assignedTo)
                                contextRow("Project", details.project); contextRow("Iteration", details.iteration); contextRow("Tags", details.tags)
                            }
                        }
                        section("Description", details.description)
                        section("Acceptance criteria", details.acceptanceCriteria)
                        if !details.links.isEmpty {
                            AppSectionHeading("Related links")
                            ForEach(details.links) { link in Link(destination: link.url) { Label(link.title, systemImage: "arrow.up.right.square") }.help(link.url.absoluteString) }
                        }
                    }
                }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.frame(width: 780, height: 620).background(Palette.background)
            .buttonStyle(.bordered).controlSize(.large)
            .task(id: ticketID) { await context.load(ticketID) }
    }
    private func contextRow(_ name: String, _ value: String) -> some View {
        GridRow { Text(name).foregroundStyle(Palette.secondary); Text(value.nonEmpty ?? "Not set").textSelection(.enabled) }
    }
    private func section(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) { AppSectionHeading(title); Text(text.nonEmpty ?? "No details provided.").textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
    }
}

struct ContextInsightsView: View {
    let data: ContextInsights
    var period: StatisticsPeriod = .week
    private var chartDays: [ContextDay] {
        guard period == .year else { return data.days }
        return Dictionary(grouping: data.days) { Calendar.current.dateInterval(of: .month, for: $0.date)!.start }
            .map { date, days in ContextDay(date: date, switches: days.reduce(0) { $0 + $1.switches }, blocks: []) }.sorted { $0.date < $1.date }
    }
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 18) {
                AppSectionHeading("Context switches", subtitle: "Understand how your recorded work is divided across tasks.")
                HStack(spacing: 35) {
                    metric("Task switches", String(data.switches))
                    metric("Longest recorded block", DurationText.short(data.longestBlock))
                    metric("Average recorded block", DurationText.short(data.averageBlock))
                }
                if period != .day { Chart(chartDays) { day in
                    BarMark(x: .value("Day", day.date, unit: period == .year ? .month : .day), y: .value("Switches", day.switches))
                        .foregroundStyle(Palette.accent).cornerRadius(4)
                        .accessibilityLabel(day.date.formatted(date: .abbreviated, time: .omitted)).accessibilityValue("\(day.switches) task switches")
                }.frame(height: 150).chartYAxis { AxisMarks(values: .automatic(desiredCount: 4)) } }
                Text("Inferred from recorded entries, not a measure of concentration. A switch changes ticket (or ticket-free activity/comment) within 15 minutes. Adjacent entries on the same task form one block; longer breaks and overlapping entries interrupt the sequence.")
                    .font(.caption).foregroundStyle(Palette.secondary)
                if data.ambiguousEntries > 0 { Label("\(data.ambiguousEntries) invalid or overlapping segments excluded.", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(Palette.warning) }
            }
        }
    }
    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) { Text(value).font(.title2.weight(.semibold)).monospacedDigit(); Text(title).font(.caption).foregroundStyle(Palette.secondary) }
    }
}

struct WeeklyReportView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var report: WeeklyReportModel
    @ViewState private var confirmReplace = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionTitle(title: "Weekly report", subtitle: "Turn your recorded work into an editable status update. Drafts stay on this Mac.")
            HStack {
                Button { report.move(-1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Previous week")
                DatePicker("Week of", selection: Binding(get: { report.anchor }, set: { report.changeDate($0) }), in: ...Date(), displayedComponents: .date)
                Button { report.move(1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel("Next week").disabled(report.range.end > Date())
                Button("This week") { report.changeDate(Date()) }
                Spacer()
                Button("Refresh time") { Task { await report.load() } }.disabled(report.loading || !report.configured)
            }
            HStack {
                Button(report.text.isEmpty ? "Generate draft" : "Regenerate draft…") {
                    if report.text.isEmpty { generate() } else { confirmReplace = true }
                }.buttonStyle(.borderedProminent).tint(Palette.action).disabled(!report.hasData || report.loading)
                if report.loading { ProgressView().controlSize(.small) }
                if let date = report.syncedAt { Text("Time loaded " + date.formatted(date: .omitted, time: .shortened)).font(.caption).foregroundStyle(Palette.secondary) }
                Spacer()
                Button("Copy") { report.copy() }.disabled(report.text.isEmpty)
                Button("Export Markdown…") { report.export() }.disabled(report.text.isEmpty)
            }
            if let issue = report.issue { Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning) }
            if let issue = report.storageIssue { Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning) }
            if !report.configured && !model.preview { Text("Connect to 7pace in Settings to generate a draft.").foregroundStyle(Palette.secondary) }
            TextEditor(text: $report.text).font(.system(.body, design: .monospaced))
                .padding(10).background(Palette.card).overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.line))
                .accessibilityLabel("Editable weekly status report")
            Text(report.message ?? "Edits are saved locally as you type. Copy or export when ready; nothing is sent automatically.").font(.callout).foregroundStyle(Palette.secondary)
        }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
            .task(id: report.range) { await report.load() }
            .task(id: report.syncedAt) {
                let range = report.range
                for id in Set(report.logs.compactMap(\.workItemId)).sorted() {
                    guard !Task.isCancelled, report.range == range else { return }; await model.loadTicketTitle(id)
                }
            }
            .confirmationDialog("Replace this week’s draft?", isPresented: $confirmReplace, titleVisibility: .visible) {
                Button("Replace draft", role: .destructive) { generate() }
                Button("Keep draft", role: .cancel) {}
            } message: { Text("This replaces your local draft with a fresh summary of the loaded time.") }
    }
    private func generate() { report.generate(targets: model.configuration.targets, titles: model.workItems.mapValues(\.title)) }
}

import SwiftUI
import AzureTimetrackerCore

struct FigmaSettingsView: View {
    @Environment(\.interfacePalette) private var palette
    @ObservedObject var model: AppModel
    @ObservedObject var figma: FigmaService
    var onboarding = false
    private func preference<Value>(_ keyPath: WritableKeyPath<FigmaPreferences, Value>) -> Binding<Value> {
        Binding(get: { model.configuration.figma[keyPath: keyPath] }, set: { value in
            var preferences = model.configuration.figma; preferences[keyPath: keyPath] = value
            model.setFigmaPreferences(preferences)
        })
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            AppSectionHeading("Figma Desktop", subtitle: "Suggest Design tracking when you switch files. Always confirm before a timer changes.")
            Toggle("Observe Figma files", isOn: preference(\.enabled))
            Text("Reads only file URLs and window titles on this Mac. No design content, Figma account, token or plugin. Browser tabs are not observed.").font(.callout).foregroundStyle(palette.secondary)
            if model.configuration.figma.enabled {
                Label(figma.status, systemImage: figma.hasAccess ? "eye" : "lock").font(.callout).fixedSize(horizontal: false, vertical: true)
                if !figma.hasAccess {
                    Button("Allow Accessibility…") { figma.requestAccess() }
                    Text("Enable Azure timetracker in System Settings → Privacy & Security → Accessibility, then return here.").font(.caption).foregroundStyle(palette.secondary)
                    Button("Check permission again") { figma.refreshPermission() }
                }
            }
            if !onboarding {
                Stepper("Keep tracking: suppress for \(model.configuration.figma.dismissalMinutes) minutes", value: preference(\.dismissalMinutes), in: 0...120)
                Stepper("Keep context history for \(model.configuration.figma.historyDays) days", value: preference(\.historyDays), in: 1...365)
                Text("Zero suppression allows a new suggestion at the next activation. Pause watching in the sidebar pauses both Git and Figma observations. Changes here save immediately.").font(.caption).foregroundStyle(palette.secondary)
            }
        }
    }
}

struct FigmaPrompt: View {
    @Environment(\.interfacePalette) private var palette
    @ObservedObject var model: AppModel
    let proposal: FigmaSuggestion
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Figma file active", systemImage: "square.stack.3d.up").font(.headline).foregroundStyle(palette.accent)
            Text(proposal.name).font(.callout.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            if let ticket = proposal.ticketID {
                Text("#" + String(ticket) + " · " + (model.workItems[ticket]?.title ?? "Azure ticket")).font(.callout)
            } else { Text("Track Design without a ticket. The file name becomes the comment.").font(.caption).foregroundStyle(palette.secondary) }
            if !compact { Text("An active file suggests context; it does not prove the design was edited.").font(.caption).foregroundStyle(palette.secondary) }
            HStack {
                Button("Start Design…") { model.beginFigmaTracking(proposal) }
                    .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
                if proposal.ticketID != nil { Button("Other ticket") { model.beginFigmaTracking(proposal, useLinkedTicket: false) }.disabled(model.busy || !model.connected) }
                Button("Keep tracking") { model.keepFigma(proposal) }.disabled(model.busy)
            }
        }
    }
}

struct FigmaView: View {
    @Environment(\.interfacePalette) private var palette
    @ObservedObject var model: AppModel
    @ObservedObject var figma: FigmaService
    @ViewState private var query = ""
    @ViewState private var linking: FigmaFile?
    @ViewState private var showHistory = false
    @ViewState private var clearHistory = false
    private var files: [FigmaFile] {
        model.figmaLedger.register.filter { file in
            let id = model.figmaLedger.links[file.key]
            return query.isEmpty || [file.name, file.key, id.map(String.init) ?? "", id.flatMap { model.workItems[$0]?.title } ?? ""].contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                SectionTitle(title: "Figma", subtitle: "Your files, ticket links and recent design context.")
                Card { FigmaSettingsView(model: model, figma: figma) }
                if let issue = model.figmaStorageIssue { Text(issue).foregroundStyle(palette.warning) }
                ForEach(model.figmaSuggestions) { proposal in Card { FigmaPrompt(model: model, proposal: proposal) } }
                if let latest = model.figmaLedger.lastWorked.first, let ticket = model.figmaLedger.links[latest.key] {
                    Card {
                        AppSectionHeading("Last worked in Figma", subtitle: "Based on the most recently seen linked file.")
                        Button("#" + String(ticket) + " · " + (model.workItems[ticket]?.title ?? "Azure ticket")) { model.showContext(ticket) }.buttonStyle(.plain).foregroundStyle(palette.accent)
                        ForEach(model.figmaLedger.lastWorked) { file in
                            HStack { Text(file.name); Spacer(); if let seen = file.lastSeen { Text(seen, style: .relative).font(.caption).foregroundStyle(palette.secondary) } }
                        }
                    }
                }
                AppSectionHeading("File register", subtitle: "Link or unlink files without changing any tracked time.")
                TextField("Search file, key or linked ticket", text: $query).textFieldStyle(.roundedBorder)
                if files.isEmpty { Card { EmptyState(symbol: "square.stack.3d.up", title: "No matching files", detail: "Enable observation, allow Accessibility and focus a file in Figma Desktop for a few seconds.") } }
                ForEach(files) { file in
                    Card {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(file.name).font(.headline).textSelection(.enabled)
                                Text(file.key).font(.caption).foregroundStyle(palette.secondary).textSelection(.enabled)
                                if let seen = file.lastSeen { Text("Last seen: " + seen.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(palette.secondary) }
                                if let ticket = model.figmaLedger.links[file.key] { Text("#" + String(ticket) + " · " + (model.workItems[ticket]?.title ?? "Azure ticket")).font(.callout) }
                                else { Text("Not linked to a ticket").font(.callout).foregroundStyle(palette.secondary) }
                            }
                            Spacer()
                            Menu("Open") {
                                Button("Figma Desktop") { model.openFigma(file.key, desktop: true) }
                                Button("Browser") { model.openFigma(file.key, desktop: false) }
                            }.fixedSize()
                        }
                        HStack {
                            Button(model.figmaLedger.links[file.key] == nil ? "Link ticket…" : "Change ticket…") { linking = file }.disabled(model.busy || !model.connected)
                            if model.figmaLedger.links[file.key] != nil { Button("Unlink") { Task { _ = await model.linkFigmaFile(file.key, ticketID: nil) } }.disabled(model.busy) }
                        }
                    }
                }
                Card {
                    HStack {
                        AppSectionHeading("Context history", subtitle: "Local observations, not recorded hours. Kept for \(model.configuration.figma.historyDays) days, up to 5,000 observations.")
                        Spacer()
                        Button(showHistory ? "Hide" : "Show history") { showHistory.toggle() }
                        Button("Clear history…") { clearHistory = true }.disabled(model.figmaLedger.history.isEmpty)
                    }
                    if showHistory {
                        ForEach(model.figmaLedger.history.reversed().prefix(200)) { event in
                            HStack(alignment: .top) {
                                Text(event.timestamp.formatted(date: .abbreviated, time: .shortened)).monospacedDigit().frame(width: 140, alignment: .leading)
                                VStack(alignment: .leading) {
                                    Text(event.name)
                                    if let ticket = event.ticketID { Text("#" + String(ticket) + " at the time").font(.caption).foregroundStyle(palette.secondary) }
                                }
                                Spacer()
                                Button("Review day") { model.dayReview.selectedDay = Calendar.current.startOfDay(for: event.timestamp); model.page = .dayReview }
                            }.font(.callout)
                            Divider()
                        }
                        if model.figmaLedger.history.count > 200 { Text("Showing the latest 200 observations.").font(.caption).foregroundStyle(palette.secondary) }
                    }
                }
            }.padding(28)
        }
        .sheet(item: $linking) { file in InterfaceSheet(interface: model.interface) { FigmaLinkView(model: model, file: file) } }
        .confirmationDialog("Clear local Figma history? Tracked hours, files and ticket links will stay.", isPresented: $clearHistory) {
            Button("Clear history", role: .destructive) { model.clearFigmaHistory() }
            Button("Cancel", role: .cancel) {}
        }
        .task(id: model.figmaLedger.links) { for id in Set(model.figmaLedger.links.values) { await model.loadTicketTitle(id) } }
    }
}

private struct FigmaLinkView: View {
    @Environment(\.interfacePalette) private var palette
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: AppModel
    let file: FigmaFile
    @ViewState private var ticket = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionTitle(title: "Link Figma file", subtitle: file.name)
            TextField("Azure ticket number", text: $ticket).textFieldStyle(.roundedBorder)
            Text("The ticket is verified before saving. This only links the file; no timer or tracked entry changes.").font(.callout).foregroundStyle(palette.secondary)
            if let error = model.error { Text(error).foregroundStyle(palette.warning) }
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.busy)
                Spacer()
                Button("Save link") { Task { if let id = Int(ticket.trimmingCharacters(in: .whitespacesAndNewlines)), await model.linkFigmaFile(file.key, ticketID: id) { dismiss() } } }
                    .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white)
                    .disabled(model.busy || Int(ticket.trimmingCharacters(in: .whitespacesAndNewlines)).map { $0 <= 0 || $0 > Int32.max } ?? true)
            }
        }.padding(28).frame(width: 530).onAppear { ticket = model.figmaLedger.links[file.key].map(String.init) ?? "" }
    }
}

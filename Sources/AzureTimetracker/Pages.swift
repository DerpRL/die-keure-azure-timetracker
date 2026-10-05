import AppKit
import AzureTimetrackerCore
import SwiftUI

// Use the property wrapper on Command Line Tools, which do not ship the
// macOS 27 SwiftUI State macro plugin.
typealias ViewState<Value> = SwiftUI.State<Value>

struct HistoryView: View {
    @ObservedObject var model: AppModel
    @ViewState<Int> private var tab = 0
    @ViewState<String> private var filter = ""
    private var filtered: [WorkLog] {
        model.logs.filter { filter.isEmpty || "\($0.workItemId ?? 0) \($0.comment ?? "") \(model.workItems[$0.workItemId ?? 0]?.title ?? "")".localizedCaseInsensitiveContains(filter) }
    }
    private var days: [Date] { Array(Set(filtered.compactMap { $0.date.map { Calendar.current.startOfDay(for: $0) } })).sorted(by: >) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 23) {
                HStack { SectionTitle(title: "History", subtitle: "Your 7pace worklogs and tracking decisions."); Spacer(); Button { model.exportHistory() } label: { Label("Export CSV", systemImage: "square.and.arrow.up") }.disabled(model.logs.isEmpty) }
                Picker("History", selection: $tab) { Text("7pace worklogs").tag(0); Text("App activity").tag(1) }.pickerStyle(.segmented).frame(width: 320)
                if tab == 0 {
                    HStack(spacing: 12) {
                        DatePicker("From", selection: $model.historyFrom, displayedComponents: .date).frame(maxWidth: 195)
                        DatePicker("To", selection: $model.historyTo, displayedComponents: .date).frame(maxWidth: 195)
                        Button("Load") { Task { await model.loadHistory() } }.disabled(model.loadingHistory || !model.connected)
                        if model.loadingHistory { ProgressView().controlSize(.small) }
                        Spacer()
                        TextField("Filter tickets", text: $filter).textFieldStyle(.roundedBorder).frame(width: 160)
                    }
                    HStack(spacing: 16) {
                        metric("TRACKED TIME", DurationText.short(filtered.reduce(0) { $0 + $1.length }))
                        metric("WORKLOGS", String(filtered.count))
                        metric("TICKETS", String(Set(filtered.compactMap(\.workItemId)).count))
                    }
                    if filtered.isEmpty {
                        Card { EmptyState(symbol: "clock.arrow.circlepath", title: model.historyLoaded ? "No worklogs in this view" : "Your history is waiting", detail: model.historyLoaded ? "Change the date range or clear the filter." : "Connect to 7pace in Settings to load your real worklogs.") }
                    }
                    ForEach(days, id: \.self) { day in
                        let dayLogs = filtered.filter { $0.date.map { Calendar.current.isDate($0, inSameDayAs: day) } == true }
                        VStack(alignment: .leading, spacing: 12) {
                            HStack { Text(day.formatted(.dateTime.weekday(.wide).day().month(.wide))).font(.headline); Spacer(); Text(DurationText.short(dayLogs.reduce(0) { $0 + $1.length })).font(.caption).foregroundStyle(Palette.secondary) }
                            Card { VStack(spacing: 0) { ForEach(dayLogs) { log in LogRow(model: model, log: log); if log.id != dayLogs.last?.id { Divider().padding(.vertical, 13) } } } }
                        }
                    }
                    let unknownDates = filtered.filter { $0.date == nil }
                    if !unknownDates.isEmpty {
                        Card { VStack(alignment: .leading) { Text("Unrecognized dates from 7pace").font(.headline); ForEach(unknownDates) { LogRow(model: model, log: $0) } } }
                    }
                } else {
                    Card {
                        if model.audit.isEmpty { EmptyState(symbol: "list.bullet.clipboard", title: "A quiet beginning", detail: "Branch changes and tracking decisions will appear here.") }
                        else {
                            LazyVStack(alignment: .leading, spacing: 18) {
                                ForEach(model.audit) { entry in
                                    HStack(alignment: .top, spacing: 14) {
                                        Image(systemName: entry.title.contains("attention") ? "exclamationmark.circle" : "circle.inset.filled").foregroundStyle(Palette.accent).padding(.top, 2)
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(entry.title).font(.system(size: 13, weight: .semibold))
                                            Text(entry.detail).font(.caption).foregroundStyle(Palette.secondary).textSelection(.enabled)
                                        }
                                        Spacer()
                                        Text(entry.date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(Palette.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }.padding(28)
        }
    }
    private func metric(_ title: String, _ value: String) -> some View {
        Card { VStack(alignment: .leading, spacing: 12) { Text(title).font(.system(size: 10, weight: .semibold)).tracking(1.1).foregroundStyle(Palette.secondary); Text(value).font(.system(size: 27, weight: .medium, design: .rounded)).monospacedDigit() } }
    }
}

struct AgendaPreview: View {
    @ObservedObject var model: AppModel
    @ObservedObject var calendar: CalendarService
    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack { Text("On your calendar").font(.headline); Spacer(); Button("View agenda") { model.page = .agenda } }
            Card {
                if !model.configuration.calendarEnabled || !calendar.authorized {
                    VStack(spacing: 12) {
                        Image(systemName: "calendar").font(.system(size: 24, weight: .light)).foregroundStyle(Palette.accent)
                        Text("Work and meetings, together.").font(.callout).multilineTextAlignment(.center)
                        Text("See the calendars connected to your Mac.").font(.caption).foregroundStyle(Palette.secondary).multilineTextAlignment(.center)
                        Button("Connect calendar") { Task { await model.enableCalendar() } }.buttonStyle(.bordered)
                    }.frame(maxWidth: .infinity).padding(.vertical, 8)
                } else {
                    let events = calendar.events.filter { $0.end > Date() || $0.allDay }.prefix(3)
                    if events.isEmpty { EmptyState(symbol: "sun.max", title: "Room to focus", detail: "No more events today.") }
                    else { VStack(alignment: .leading, spacing: 20) { ForEach(Array(events)) { event in EventRow(event: event, compact: true) } } }
                }
            }
        }
    }
}

struct EventRow: View {
    let event: AgendaEvent
    var compact = false
    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            RoundedRectangle(cornerRadius: 2).fill(Color(nsColor: event.color)).frame(width: 3, height: compact ? 42 : 52)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(event.allDay ? "All day" : event.start.formatted(date: .omitted, time: .shortened) + " – " + event.end.formatted(date: .omitted, time: .shortened))
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.secondary)
                    if event.isNow { Text("NOW").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.accent) }
                }
                Text(event.title).font(.system(size: compact ? 13 : 15, weight: .medium)).lineLimit(compact ? 2 : 4)
                if !compact { Text(event.calendar + (event.location?.nonEmpty.map { " · \($0)" } ?? "")).font(.caption).foregroundStyle(Palette.secondary) }
            }
            Spacer(minLength: 0)
        }
    }
}

struct AgendaView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var calendar: CalendarService
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack { SectionTitle(title: "Agenda", subtitle: "Events from the calendars connected to this Mac."); Spacer(); Button("Open Calendar") { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Calendar.app")) } }
                if let error = calendar.error { Text(error).font(.callout).foregroundStyle(Palette.warning) }
                if !calendar.authorized || !model.configuration.calendarEnabled {
                    Card {
                        VStack {
                            EmptyState(symbol: "calendar.badge.clock", title: "Bring your day into view", detail: "Connect Apple Calendar to see your Exchange, iCloud, Google, and other calendars already added to macOS. Your events are only read.")
                            Button("Allow calendar access") { Task { await model.enableCalendar() } }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white)
                        }.frame(maxWidth: .infinity).padding(.bottom, 16)
                    }
                } else {
                    HStack(spacing: 14) {
                        Button { moveDay(-1) } label: { Image(systemName: "chevron.left").frame(width: 24, height: 24) }.accessibilityLabel("Previous day").help("Previous day")
                        DatePicker("Day", selection: $calendar.selectedDate, displayedComponents: .date).labelsHidden()
                        Button { moveDay(1) } label: { Image(systemName: "chevron.right").frame(width: 24, height: 24) }.accessibilityLabel("Next day").help("Next day")
                        Button("Today") { calendar.selectedDate = Date(); model.refreshCalendar() }
                        Spacer()
                        Text("\(calendar.events.count) events").font(.callout).foregroundStyle(Palette.secondary)
                    }
                    .onChange(of: calendar.selectedDate) { _, _ in model.refreshCalendar() }
                    Card {
                        if calendar.events.isEmpty { EmptyState(symbol: "sun.max", title: "An open day", detail: "No events in your selected calendars.") }
                        else { VStack(spacing: 22) { ForEach(calendar.events) { event in EventRow(event: event); if event.id != calendar.events.last?.id { Divider() } } } }
                    }
                    Text("Missing a calendar? Add its account in macOS System Settings → Internet Accounts and enable Calendars.").font(.caption).foregroundStyle(Palette.secondary)
                }
            }.padding(28)
        }
    }
    private func moveDay(_ delta: Int) { calendar.selectedDate = Calendar.current.date(byAdding: .day, value: delta, to: calendar.selectedDate)!; model.refreshCalendar() }
}

struct RepositoriesView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack { SectionTitle(title: "Repositories", subtitle: "Choose which local Git repositories to watch."); Spacer(); Button { model.addRepository() } label: { Label("Add repository", systemImage: "plus") }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white) }
                if model.configuration.repositories.isEmpty { Card { EmptyState(symbol: "folder.badge.plus", title: "Choose your repositories", detail: "Add each repository root to watch branch changes, including Git worktrees.") } }
                ForEach(model.configuration.repositories) { repo in
                    Card {
                        HStack(alignment: .top, spacing: 16) {
                            Image(systemName: "folder").font(.system(size: 23, weight: .light)).foregroundStyle(Palette.accent).padding(.top, 3)
                            VStack(alignment: .leading, spacing: 9) {
                                Text(repo.name).font(.system(size: 16, weight: .semibold))
                                Text(repo.path).font(.caption).foregroundStyle(Palette.secondary).textSelection(.enabled)
                                if let error = model.repositoryErrors[repo.id] { Text(error).font(.caption).foregroundStyle(Palette.warning) }
                                else { Label(model.branches[repo.id]?.label ?? (repo.enabled ? "Reading branch…" : "Paused"), systemImage: "arrow.triangle.branch").font(.system(size: 12, design: .monospaced)).foregroundStyle(Palette.accent) }
                            }
                            Spacer()
                            Toggle("Watch \(repo.name)", isOn: Binding(get: { repo.enabled }, set: { model.setRepository(repo.id, enabled: $0) })).labelsHidden().toggleStyle(.switch).controlSize(.small)
                            Button { model.removeRepository(repo.id) } label: { Label("Remove", systemImage: "minus.circle") }.help("Remove from watch list; repository files are preserved").accessibilityLabel("Remove " + repo.name + " from watch list")
                        }
                    }
                }
            }.padding(28)
        }
    }
}

enum SettingsCategory: String, CaseIterable, Identifiable {
    case accounts = "Accounts", tracking = "Tracking", meetings = "Meetings", dayReview = "Day review", app = "App"
    var id: Self { self }
}

struct SettingsPage: View {
    @ObservedObject var model: AppModel
    @ViewState<Configuration> private var draft = Configuration()
    @ViewState<String> private var pat = ""
    @ViewState<String> private var token = ""
    @ViewState<String> private var testBranch = "feature/33624-improve-loading"
    @ViewState<Bool> private var saved = false
    @ViewState<SettingsCategory> private var category = .accounts
    private var testResult: String {
        do { return try BranchTicket.extract(from: testBranch, pattern: draft.branchPattern).map { "Ticket #\($0)" } ?? "No unique ticket found" }
        catch { return "Invalid pattern: \(error.localizedDescription)" }
    }
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                SectionTitle(title: "Settings", subtitle: "Choose a section. Save changes when you’re ready.")
                Picker("Settings section", selection: $category) {
                    ForEach(SettingsCategory.allCases) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.segmented).accessibilityLabel("Settings section")
            }.padding(28)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    switch category {
                    case .accounts: accountSection; connectionSection
                    case .tracking: targetSection; Card { HolidaySettingsView(targets: $draft.targets) }; branchSection
                    case .meetings: calendarSection; meetingSection; microphoneSection
                    case .dayReview: Card { DayReviewSettings(preferences: $draft.dayReview) }
                    case .app: appSection
                    }
                }.padding(28).frame(maxWidth: 880, alignment: .leading).frame(maxWidth: .infinity)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 12) {
                    Button(model.busy ? "Saving…" : "Save changes") {
                        Task {
                            draft.repositories = model.configuration.repositories
                            saved = await model.saveSettings(draft, pat: pat.trimmingCharacters(in: .whitespacesAndNewlines), token: token.trimmingCharacters(in: .whitespacesAndNewlines))
                            if saved { pat = ""; token = "" }
                        }
                    }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).controlSize(.large).disabled(model.busy || model.preview).keyboardShortcut("s", modifiers: .command)
                    if saved { Label(model.connected ? "Settings saved · connection verified" : "Settings saved", systemImage: "checkmark.circle").font(.callout).foregroundStyle(Palette.accent) }
                    Spacer()
                }
                Text("⌘S saves all sections. Calendar permission and launch-at-login changes apply immediately.")
                    .font(.callout).foregroundStyle(Palette.secondary)
            }.padding(.horizontal, 28).padding(.vertical, 16).frame(maxWidth: .infinity).background(Palette.card)
        }
        .onAppear { draft = model.configuration; model.refreshCalendar() }
        .onChange(of: draft) { _, _ in saved = false }
        .onChange(of: pat) { _, value in if !value.isEmpty { saved = false } }
        .onChange(of: token) { _, value in if !value.isEmpty { saved = false } }
    }
    private var accountSection: some View {
Card {
                    VStack(alignment: .leading, spacing: 19) {
                        Label("Accounts & connection", systemImage: "link").font(.headline)
                        field("Azure organization", help: "The name in dev.azure.com/your-organization") { TextField("your-organization", text: $draft.organization) }
                        field("Azure project", help: "Optional. Leave empty to find tickets across your organization.") { TextField("Project name", text: $draft.project) }
                        field("Azure DevOps PAT", help: model.hasAzurePAT ? "Saved in Keychain. Leave blank to keep it." : "Work Items (Read) permission is enough for ticket lookup.") { SecureField("Paste your Azure PAT", text: $pat) }
                        Divider()
                        field("7pace workspace", help: "Use your organization’s 7pace workspace URL, without /api.") { TextField("https://your-organization.timehub.7pace.com", text: $draft.sevenPaceURL) }
                        Picker("7pace sign-in", selection: Binding(get: { draft.sevenPaceAuthMode ?? .apiToken }, set: { draft.sevenPaceAuthMode = $0 })) {
                            Text("Mobile PIN pairing").tag(SevenPaceAuthMode.mobilePIN)
                            Text("API token").tag(SevenPaceAuthMode.apiToken)
                        }
                        if draft.sevenPaceAuthMode == .mobilePIN {
                            PinPairingView(pairing: model.pinPairing, workspace: draft.sevenPaceURL, disabled: model.preview || model.busy)
                        } else {
                            field("7pace API token", help: "Saved in Keychain. Leave blank to keep the existing API token.") { SecureField("Paste your 7pace API token", text: $token) }
                            Label("Or choose Mobile PIN pairing above to connect without creating an API token.", systemImage: "lock.shield").font(.callout).foregroundStyle(Palette.secondary)
                        }
                        if !model.activityTypes.isEmpty {
                            Picker("Default activity", selection: $draft.activityTypeID) {
                                Text("Use 7pace default").tag("")
                                ForEach(model.activityTypes) { Text($0.name ?? $0.id).tag($0.id) }
                            }
                        } else {
                            field("Activity type ID", help: "Optional. Only needed if your organization requires a specific activity.") { TextField("Use 7pace default", text: $draft.activityTypeID) }
                        }
                    }
                }
    }
    private var targetSection: some View {
Card {
                    VStack(alignment: .leading, spacing: 16) {
                        Label("Time targets & quick switch", systemImage: "scope").font(.headline)
                        ForEach([2, 3, 4, 5, 6, 7, 1], id: \.self) { weekday in
                            HStack {
                                Text(Calendar.current.weekdaySymbols[weekday - 1]); Spacer()
                                TextField("Hours", value: Binding(get: { draft.targets.hours(weekday: weekday) }, set: { draft.targets.setHours($0, weekday: weekday) }), format: .number)
                                    .frame(width: 90).accessibilityLabel(Calendar.current.weekdaySymbols[weekday - 1] + " target hours")
                                Text("hours").foregroundStyle(Palette.secondary)
                            }
                        }
                        HStack {
                            Text("Base weekly total").font(.headline); Spacer()
                            Text(draft.targets.isValid ? DurationText.short(draft.targets.weeklyTargetHours * 3600) : "Check daily hours").font(.headline).monospacedDigit()
                        }
                        Button("Use Mon–Thu 8h, Friday 6h") {
                            for (day, hours) in [(1, 0.0), (2, 8.0), (3, 8.0), (4, 8.0), (5, 8.0), (6, 6.0), (7, 0.0)] { draft.targets.setHours(hours, weekday: day) }
                        }
                        Text("Enter decimal hours, such as 7.5 for 7h 30m. Use 0 for a day off. Weekly totals, progress rings, day reviews and statistics follow this schedule.")
                            .font(.callout).foregroundStyle(Palette.secondary)
                        Toggle("Quick switch from any app · ⌃⌥T", isOn: Binding(get: { draft.quickSwitchEnabled ?? true }, set: { draft.quickSwitchEnabled = $0 }))
                        Text("Control + Option + T opens ticket search with favorites and recent tickets. Choose an activity before switching.")
                            .font(.callout).foregroundStyle(Palette.secondary)
                        if let issue = model.shortcutIssue { Text(issue).font(.callout).foregroundStyle(Palette.warning) }
                    }.textFieldStyle(.roundedBorder)
                }
    }
    private var connectionSection: some View {
        ConnectionHealthView(model: model)
    }
    private var branchSection: some View {
Card {
                    VStack(alignment: .leading, spacing: 19) {
                        Label("Branch detection", systemImage: "arrow.triangle.branch").font(.headline)
                        Toggle("Watch repositories for branch changes", isOn: $draft.watchEnabled)
                        Toggle("Automatically open the activity chooser when no timer is running", isOn: $draft.autoStartWhenIdle)
                        Text("Every timer starts after you choose its activity and confirm. This option opens the chooser for a new branch change after connecting, not app startup.").font(.callout).foregroundStyle(Palette.secondary)
                        field("Ticket pattern", help: "The first capture group is the ticket number. Supports feature/123-name and featute/123-name.") { TextField("Regular expression", text: $draft.branchPattern).font(.system(.body, design: .monospaced)) }
                        HStack {
                            TextField("Try a branch name", text: $testBranch).textFieldStyle(.roundedBorder)
                            Text(testResult).font(.callout).foregroundStyle(Palette.accent).frame(minWidth: 135)
                        }
                        Picker("Refresh 7pace", selection: $draft.pollSeconds) {
                            Text("Every 30 seconds").tag(30); Text("Every minute").tag(60); Text("Every 2 minutes").tag(120); Text("Every 5 minutes").tag(300)
                        }
                        Text("Local branch checks run every 2 seconds. Server rate limits are respected.").font(.callout).foregroundStyle(Palette.secondary)
                    }
                }
    }
    private var calendarSection: some View {
Card {
                    VStack(alignment: .leading, spacing: 18) {
                        Label("Apple Calendar", systemImage: "calendar").font(.headline)
                        Toggle("Show my Apple Calendar agenda", isOn: $draft.calendarEnabled)
                        if !model.calendar.authorized {
                            Button("Allow calendar access…") { Task { await model.enableCalendar(); draft.calendarEnabled = model.configuration.calendarEnabled } }
                        } else {
                            CalendarChoices(calendar: model.calendar, selectedIDs: $draft.selectedCalendarIDs)
                        }
                        Text("Calendar events stay on your Mac and are never sent to Azure or 7pace.").font(.callout).foregroundStyle(Palette.secondary)
                    }
                }
    }
    private var meetingSection: some View {
Card {
                    VStack(alignment: .leading, spacing: 18) {
                        Label("Meeting suggestions", systemImage: "calendar.badge.clock").font(.headline)
                        Toggle("Suggest tracking when a meeting starts", isOn: $draft.meetings.enabled)
                        Text("Uses your selected Apple calendars. Timed events open a suggestion once; all-day, declined, canceled, and free events are skipped. Your timer changes only after you confirm Start.")
                            .font(.callout).foregroundStyle(Palette.secondary)
                        if !draft.calendarEnabled || !model.calendar.authorized {
                            Label("Enable Apple Calendar access in this section to receive meeting suggestions.", systemImage: "info.circle")
                                .font(.callout).foregroundStyle(Palette.warning)
                        }
                        field("Default meeting ticket", help: "Optional fallback when the meeting has no ticket. Put #33984 in its title or an Azure work-item link in its title, URL, or notes to link a specific ticket.") {
                            TextField("Choose a ticket for each meeting", text: $draft.meetings.defaultTicket)
                        }
                        Picker("Meeting activity", selection: $draft.meetings.activityTypeID) {
                            Text("Suggest Stand-up or Overleg / Meeting").tag("")
                            ForEach(model.activityTypes) { Text($0.name ?? $0.id).tag($0.id) }
                        }
                        Text("The suggested ticket and activity can both be changed before starting. When a meeting timer ends, the app offers to resume your previous ticket and activity.").font(.callout).foregroundStyle(Palette.secondary)
                    }
                }
    }
    private var microphoneSection: some View {
Card { MicrophoneSettings(preferences: $draft.microphone, service: model.microphone) }
    }
    private var appSection: some View {
        Card {
            VStack(alignment: .leading, spacing: 20) {
                AppSectionHeading("App preferences", subtitle: "How Azure timetracker works on your Mac.")
                Toggle("Open Azure timetracker at login", isOn: Binding(get: { model.loginEnabled }, set: { model.setLogin($0) }))
                Toggle("Show macOS notifications for branches and day reviews", isOn: $draft.notificationsEnabled)
                Text("The app stays in the menu bar when its window closes. Quitting leaves the 7pace timer running.").foregroundStyle(Palette.secondary)
                Divider()
                AppSectionHeading("Keyboard navigation")
                Text("⌘1–⌘9 opens the matching navigation page; ⌘0 opens Offline drafts. ⌘⇧D opens today’s review. ⌃⌥T opens quick switch when enabled in Tracking settings. ⌘S saves Settings.")
                Text("Buttons use visible labels and system focus indicators. Enable Keyboard navigation in macOS System Settings to use Tab across all controls.").foregroundStyle(Palette.secondary)
                Divider()
                Text("Azure timetracker 1.9.0").font(.headline)
                Text("Credentials are kept in macOS Keychain. Day review status is stored only on this Mac.").foregroundStyle(Palette.secondary)
            }.font(.body)
        }
    }
    private func field<Content: View>(_ label: String, help: String, @ViewBuilder input: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 20) {
            Text(label).font(.body.weight(.medium)).frame(width: 143, alignment: .leading).padding(.top, 5)
            VStack(alignment: .leading, spacing: 6) { input().textFieldStyle(.roundedBorder).accessibilityLabel(label).help(help); Text(help).font(.callout).foregroundStyle(Palette.secondary) }
        }
    }
}

struct CalendarChoices: View {
    @ObservedObject var calendar: CalendarService
    @Binding var selectedIDs: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Calendars · leave all unchecked to show every calendar").font(.caption).foregroundStyle(Palette.secondary)
            ForEach(calendar.calendars, id: \.calendarIdentifier) { calendar in
                Toggle(calendar.title + " · " + calendar.source.title, isOn: Binding(get: { selectedIDs.contains(calendar.calendarIdentifier) }, set: { enabled in
                    if enabled { selectedIDs.append(calendar.calendarIdentifier) } else { selectedIDs.removeAll { $0 == calendar.calendarIdentifier } }
                })).toggleStyle(.checkbox)
            }
        }
    }
}

struct TicketPicker: View {
    @ObservedObject var model: AppModel
    @ViewState<String> private var query = ""
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack { SectionTitle(title: "Choose a ticket", subtitle: model.selectedChange.map { "For \($0.repositoryName) · \($0.branch)" } ?? "Search Azure tickets by number or title."); Spacer(); Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) }
            HStack {
                TextField("Ticket number or title", text: $query).textFieldStyle(.roundedBorder).onSubmit { Task { await model.search(query) } }
                Button("Search") { Task { await model.search(query) } }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.searching || !model.connected)
            }
            if model.searching { ProgressView().controlSize(.small) }
            if let error = model.searchError { Text(error).font(.callout).foregroundStyle(Palette.warning) }
            if let error = model.error { Text(error).font(.callout).foregroundStyle(Palette.warning) }
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(model.searchResults) { item in
                        HStack(spacing: 15) {
                            VStack(alignment: .leading, spacing: 7) {
                                Text("#\(String(item.id)) · \(item.type ?? "Work item")").font(.caption).foregroundStyle(Palette.accent)
                                Text(item.title).font(.system(size: 14, weight: .medium))
                                if let project = item.teamProject { Text(project).font(.caption).foregroundStyle(Palette.secondary) }
                            }
                            Spacer()
                            Button("Choose activity…") { Task { await model.chooseActivity(for: item.id, change: model.selectedChange) } }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
                        }.padding(17).background(Palette.card, in: RoundedRectangle(cornerRadius: 12))
                    }
                    if model.searchResults.isEmpty && !model.searching {
                        EmptyState(symbol: "magnifyingglass", title: "One ticket at a time", detail: model.connected ? "Enter a ticket number or a few words from its title." : "Connect your account in Settings first.")
                    }
                }
            }
            Text("Next, choose an activity type and confirm when to start.").font(.caption).foregroundStyle(Palette.secondary)
        }.padding(28).frame(width: 650, height: 490).controlSize(.large).buttonStyle(.bordered)
            .onAppear { query = model.selectedChange?.ticketID.map(String.init) ?? ""; model.searchResults = []; model.searchError = nil; if !query.isEmpty { Task { await model.search(query) } } }
    }
}

struct ActivityPicker: View {
    @ObservedObject var model: AppModel
    let draft: TrackingDraft
    @ViewState<String> private var activityID = ""
    @Environment(\.dismiss) private var dismiss
    private var canStart: Bool {
        model.activityTypesLoaded && !model.loadingActivities && !model.busy && model.connected &&
            (model.activityTypes.isEmpty || model.activityTypes.contains { $0.id == activityID })
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            SectionTitle(title: "Choose an activity", subtitle: "Review the activity before starting this session.")
            VStack(alignment: .leading, spacing: 8) {
                Text(draft.item.map { "#\(String($0.id)) · \($0.type ?? "Work item")" } ?? "No Azure ticket").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
                Text(draft.title).font(.system(size: 18, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                if let remark = draft.remark { Text("Comment: " + remark).font(.callout).foregroundStyle(Palette.secondary) }
                if let project = draft.item?.teamProject { Text(project).font(.callout).foregroundStyle(Palette.secondary) }
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.card, in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 12) {
                if model.loadingActivities {
                    ProgressView("Loading 7pace activities…")
                } else if let error = model.activityError {
                    Text(error).font(.callout).foregroundStyle(Palette.warning)
                    Button("Reload activity types") { Task { await model.refreshActivities() } }
                } else if model.activityTypes.isEmpty {
                    Text("No activity types are configured in 7pace. Its workspace default will be used.").font(.callout).foregroundStyle(Palette.secondary)
                } else {
                    Picker("Activity type", selection: $activityID) {
                        Text("Choose an activity").tag("")
                        ForEach(model.activityTypes) { type in
                            Text(type.name ?? type.id).tag(type.id)
                        }
                    }.pickerStyle(.menu).controlSize(.large)
                    Text("This applies to this session. Your saved default stays the same.").font(.caption).foregroundStyle(Palette.secondary)
                }
            }
            Text(draft.resume != nil ? "Resume starts a new session. Paused time is not logged." : model.state?.running == true
                 ? "Your current timer continues until you press Start tracking."
                 : "The timer starts when you press Start tracking.")
                .font(.callout).foregroundStyle(Palette.secondary)
            if model.busy { ProgressView("Starting tracking…").controlSize(.small) }
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.busy)
                Spacer()
                Button(draft.resume == nil ? "Start tracking" : "Resume tracking") { Task { await model.startTracking(draft, activityID: activityID) } }
                    .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).controlSize(.large).keyboardShortcut(.defaultAction).disabled(!canStart)
            }
        }.padding(28).frame(width: 540).tint(Palette.accent)
            .onAppear {
                let saved = model.preferredActivityID(for: draft)
                activityID = model.activityTypes.contains { $0.id == saved } ? saved : ""
            }
            .onChange(of: model.activityTypes) { _, types in
                if !types.contains(where: { $0.id == activityID }) {
                    let saved = model.preferredActivityID(for: draft)
                    activityID = types.contains { $0.id == saved } ? saved : ""
                }
            }
    }
}

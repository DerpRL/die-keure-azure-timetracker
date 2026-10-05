import AppKit
import SwiftUI
import AzureTimetrackerCore

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()
    private var menuBar: MenuBarController?
    private var quickSwitch: QuickSwitchShortcut?
    private var overviewWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        model.revealWindow = { [weak self] in self?.showOverview() }
        menuBar = MenuBarController(model: model)
        quickSwitch = QuickSwitchShortcut(model: model)
        // Watching and the status item must work before any overview is opened.
        model.start()
        #if UI_PREVIEW
        model.page = .statistics
        showOverview()
        #endif
    }

    private func showOverview() {
        model.dismissMenuPanel?()
        if overviewWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 820),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Azure timetracker"
            window.identifier = NSUserInterfaceItemIdentifier("main")
            window.isReleasedWhenClosed = false
            window.contentMinSize = NSSize(width: 1040, height: 720)
            window.contentView = NSHostingView(rootView: RootView(model: model)
                .frame(minWidth: 1040, minHeight: 720).tint(Palette.accent))
            if !window.setFrameUsingName("AzureTimetrackerOverview") { window.center() }
            window.setFrameAutosaveName("AzureTimetrackerOverview")
            overviewWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        overviewWindow?.makeKeyAndOrderFront(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { quickSwitch?.stop() }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { false }
}

@main struct AzureTimetrackerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    private var model: AppModel { delegate.model }
    var body: some Scene {
        // The overview is created only through the menu bar, so launching the
        // agent (including at login) never opens or restores a normal window.
        Settings { EmptyView() }
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { model.page = .settings; model.revealWindow?() }
                    .keyboardShortcut(",")
            }
            CommandMenu("Tracking") {
                Button("Review today") { model.openDayReview() }.keyboardShortcut("d", modifiers: [.command, .shift])
                Button("Quick switch · ⌃⌥T") { model.quickSwitch() }
                Button("Choose ticket…") { model.selectedChange = nil; model.showTicketPicker = true; model.revealWindow?() }
                    .keyboardShortcut("n")
                Button("Stop tracking") { Task { await model.stopTracking() } }
                    .disabled(!model.connected || model.state?.running != true || model.busy)
                Button("Pause tracking") { Task { await model.pauseTracking() } }
                    .disabled(!model.connected || model.state?.running != true || model.busy)
                Button("Resume tracking…") { model.resumeTracking() }
                    .disabled(!model.connected || model.pausedSession == nil || model.busy)
                Button("Refresh") { Task { await model.refresh() } }.keyboardShortcut("r")
            }
        }
    }
}

enum Palette {
    static func adaptive(light: (CGFloat, CGFloat, CGFloat), dark: (CGFloat, CGFloat, CGFloat)) -> NSColor {
        NSColor(name: nil) { appearance in
            let c = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: 1)
        }
    }
    static let accent = Color(nsColor: adaptive(light: (0.03, 0.38, 0.36), dark: (0.35, 0.88, 0.80)))
    static let action = Color(red: 0.03, green: 0.38, blue: 0.36)
    static let secondary = Color(nsColor: adaptive(light: (0.34, 0.37, 0.40), dark: (0.76, 0.79, 0.82)))
    static let warningColor = adaptive(light: (0.58, 0.29, 0), dark: (1, 0.74, 0.34))
    static let warning = Color(nsColor: warningColor)
    static let background = Color(nsColor: .windowBackgroundColor)
    static let card = Color(nsColor: .controlBackgroundColor)
    static let line = Color.primary.opacity(0.16)
}

struct RootView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 238)
            Rectangle().fill(Palette.line).frame(width: 1)
            VStack(spacing: 0) {
                header
                Divider().opacity(0.6)
                if model.preview {
                    Text("Preview mode · account changes and tracking are disabled")
                        .font(.caption).foregroundStyle(Palette.accent)
                        .frame(maxWidth: .infinity).padding(8).background(Palette.accent.opacity(0.08))
                }
                if let error = model.error {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.warning)
                        Text(error).font(.callout).textSelection(.enabled)
                        Spacer()
                        Button { model.error = nil } label: { Label("Dismiss", systemImage: "xmark") }.accessibilityLabel("Dismiss error")
                    }.padding(14).background(Color.orange.opacity(0.09))
                }
                Group {
                    switch model.page {
                    case .overview: OverviewView(model: model)
                    case .dayReview: DayReviewView(model: model, review: model.dayReview)
                    case .statistics: StatisticsView(model: model, statistics: model.statistics)
                    case .history: HistoryView(model: model)
                    case .offlineDrafts: OfflineDraftView(model: model, offline: model.offlineDrafts)
                    case .timeEditor: TimeEditorView(model: model, editor: model.timeEditor)
                    case .weeklyReport: WeeklyReportView(model: model, report: model.weeklyReport)
                    case .agenda: AgendaView(model: model, calendar: model.calendar)
                    case .repositories: RepositoriesView(model: model)
                    case .settings: SettingsPage(model: model)
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }.background(Palette.background)
        }
        .controlSize(.large).buttonStyle(.bordered)
        .sheet(item: $model.contextRequest) { request in
            TicketContextView(model: model, context: model.ticketContext, ticketID: request.id)
        }
        .sheet(isPresented: $model.showTicketPicker, onDismiss: {
            model.trackingDraft = nil; model.selectedChange = nil; model.selectedMeeting = nil
        }) {
            if let draft = model.trackingDraft {
                ActivityPicker(model: model, draft: draft).interactiveDismissDisabled(model.busy)
            } else { TicketPicker(model: model) }
        }
    }
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 11) {
                Image(systemName: "clock").font(.system(size: 22, weight: .medium))
                    .foregroundStyle(.white).frame(width: 42, height: 42)
                    .background(Color(red: 0.12, green: 0.13, blue: 0.14), in: RoundedRectangle(cornerRadius: 13))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Azure").font(.system(size: 18, weight: .bold))
                    Text("timetracker").font(.system(size: 12)).foregroundStyle(Palette.secondary)
                }
            }.padding(.top, 16).padding(.horizontal, 20)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    navigationSection("Today", pages: [.overview, .dayReview, .agenda, .offlineDrafts])
                    navigationSection("Insights", pages: [.statistics, .weeklyReport, .history, .timeEditor])
                    navigationSection("Setup", pages: [.repositories, .settings])
                }.padding(.horizontal, 12)
            }.scrollIndicators(.hidden)
            Spacer()
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 7) {
                    Circle().fill(model.configuration.watchEnabled ? Palette.accent : Color.secondary).frame(width: 6, height: 6)
                    Text(model.configuration.watchEnabled ? "Watching your branches" : "Branch watching paused").font(.caption.weight(.medium))
                }
                Text("\(model.configuration.repositories.filter(\.enabled).count) repositories enabled")
                    .font(.callout).foregroundStyle(Palette.secondary)
                Button(model.configuration.watchEnabled ? "Pause watching" : "Resume watching") { model.toggleWatching() }
                    .font(.callout).frame(maxWidth: .infinity)
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.card.opacity(0.7), in: RoundedRectangle(cornerRadius: 12)).padding(12)
        }.background(Palette.card)
    }
    private func navigationSection(_ title: String, pages: [AppPage]) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.callout.weight(.semibold)).foregroundStyle(Palette.secondary).padding(.horizontal, 10).accessibilityAddTraits(.isHeader)
            ForEach(pages) { page in
                Button { model.page = page } label: {
                    HStack(spacing: 11) {
                        Image(systemName: page.symbol).frame(width: 22).accessibilityHidden(true)
                        Text(page.rawValue).font(.system(size: 14, weight: model.page == page ? .semibold : .regular))
                        Spacer(minLength: 2)
                        if page == .dayReview && model.reviewPromptDay != nil {
                            Image(systemName: "circle.fill").font(.system(size: 7)).accessibilityHidden(true)
                        }
                        if model.page == page { Image(systemName: "chevron.right").font(.caption.weight(.bold)).accessibilityHidden(true) }
                    }.foregroundStyle(model.page == page ? Palette.accent : .primary)
                        .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading).padding(.horizontal, 6)
                        .contentShape(Rectangle())
                }.buttonStyle(.bordered).tint(model.page == page ? Palette.accent : Color.secondary)
                    .accessibilityValue(model.page == page ? "Selected" : page == .dayReview && model.reviewPromptDay != nil ? "Review pending" : "")
                    .keyboardShortcut(KeyEquivalent(Character(String(((AppPage.allCases.firstIndex(of: page) ?? 0) + 1) % 10))), modifiers: .command)
            }
        }
    }
    private var header: some View {
        HStack {
            Text(model.page.rawValue).font(.system(size: 15, weight: .semibold))
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(model.connected ? Palette.accent : Color.secondary).frame(width: 6, height: 6)
                Text(model.connectionHealth.label)
                    .font(.caption).foregroundStyle(Palette.secondary)
            }
            Button { Task { await model.refresh() } } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }.disabled(model.busy || !model.hasSevenPaceToken).help("Refresh 7pace")
            if model.busy { ProgressView().controlSize(.small) }
        }.padding(.horizontal, 28).frame(height: 57)
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content.padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Palette.line, lineWidth: 1))
    }
}

struct SectionTitle: View {
    var title: String
    var subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 27, weight: .bold, design: .rounded)).accessibilityAddTraits(.isHeader)
            if let subtitle { Text(subtitle).font(.body).foregroundStyle(Palette.secondary) }
        }
    }
}

struct AppSectionHeading: View {
    var title: String
    var subtitle: String?
    init(_ title: String, subtitle: String? = nil) { self.title = title; self.subtitle = subtitle }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
            if let subtitle { Text(subtitle).font(.callout).foregroundStyle(Palette.secondary) }
        }
    }
}

struct EmptyState: View {
    var symbol: String
    var title: String
    var detail: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 27, weight: .light)).foregroundStyle(Palette.accent).padding(.bottom, 3)
            Text(title).font(.system(size: 15, weight: .semibold))
            Text(detail).font(.callout).foregroundStyle(Palette.secondary).multilineTextAlignment(.center).frame(maxWidth: 420)
        }.frame(maxWidth: .infinity).padding(.vertical, 25)
    }
}

struct OverviewView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 23) {
                HStack(alignment: .top) {
                    SectionTitle(title: "Today", subtitle: Date().formatted(.dateTime.weekday(.wide).day().month(.wide)))
                    Spacer()
                    Button { model.selectedChange = nil; model.showTicketPicker = true } label: { Label("Track a ticket", systemImage: "plus") }
                        .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).controlSize(.large).disabled(!model.connected || model.busy)
                }
                if !model.hasSevenPaceToken {
                    Card {
                        HStack(spacing: 16) {
                            Image(systemName: "link.circle.fill").font(.system(size: 32)).foregroundStyle(Palette.accent)
                            VStack(alignment: .leading, spacing: 5) {
                                Text("A little setup. A lot less forgotten time.").font(.headline)
                                Text("Connect 7pace, add your Azure PAT, and your branches will bring the right ticket to you.").font(.callout).foregroundStyle(Palette.secondary)
                            }
                            Spacer()
                            Button("Set up accounts") { model.page = .settings }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white)
                        }
                    }
                }
                AppSectionHeading("Current tracking", subtitle: "Start, pause or finish your active work.")
                timerCard
                if let prompt = model.trackingAttention { Card { TrackingAttentionPrompt(model: model, prompt: prompt) } }
                if model.reviewPromptDay != nil { Card { DayReviewPrompt(model: model) } }
                AppSectionHeading("Progress", subtitle: "Your daily and weekly targets.")
                TargetProgressView(model: model)
                if model.meetingReturnReady || !model.pendingMicrophoneSessions.isEmpty || !model.pendingMeetings.isEmpty || !model.pending.isEmpty {
                    AppSectionHeading("Suggestions", subtitle: "Review a change before switching your timer.")
                }
                if model.meetingReturnReady { Card { MeetingReturnPrompt(model: model) } }
                ForEach(model.pendingMicrophoneSessions) { microphoneSession in Card { MicrophonePrompt(model: model, microphoneSession: microphoneSession) } }
                ForEach(model.pendingMeetings) { meeting in Card { MeetingPrompt(model: model, meeting: meeting) } }
                ForEach(model.pending) { change in BranchPrompt(model: model, change: change) }
                AppSectionHeading("Work and calendar")
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 15) {
                        HStack { Text("Today’s time").font(.headline); Spacer(); Button("View history") { model.page = .history } }
                        Card {
                            let today = model.todayLogs
                            if today.isEmpty { EmptyState(symbol: "clock", title: "A clear start", detail: model.historyLoaded ? "Your completed worklogs will appear here as you track." : "Connect 7pace to see today’s worklogs.") }
                            else { VStack(spacing: 0) { ForEach(Array(today.prefix(5))) { log in LogRow(model: model, log: log); if log.id != today.prefix(5).last?.id { Divider().padding(.vertical, 10) } } } }
                        }
                    }.frame(maxWidth: .infinity)
                    AgendaPreview(model: model, calendar: model.calendar).frame(width: 285)
                }
                AppSectionHeading("Connection")
                ConnectionHealthView(model: model)
                HStack {
                    Image(systemName: "checkmark.shield").foregroundStyle(Palette.accent)
                    Text("Tokens stay in Keychain. Your Git repositories stay untouched.").font(.caption).foregroundStyle(Palette.secondary)
                    Spacer()
                }
            }.padding(28)
        }.onAppear { model.calendar.selectedDate = Date(); model.refreshCalendar() }
    }
    private var timerCard: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack(alignment: .center, spacing: 26) {
                VStack(alignment: .leading, spacing: 15) {
                    HStack(spacing: 7) {
                        Circle().fill(model.state?.running == true ? Color.mint : Color.white.opacity(0.45)).frame(width: 7, height: 7)
                        Text(model.state?.running == true ? (model.connected ? "CURRENTLY TRACKING" : "LAST KNOWN TIMER") : model.pausedSession != nil ? "PAUSED · NO TIME LOGGED" : "READY WHEN YOU ARE")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    }
                    Text(model.state?.running == true ? model.currentTicketTitle : model.pausedSession != nil ? model.pausedTicketTitle : "Your next focus starts here.")
                        .font(.system(size: 22, weight: .semibold)).foregroundStyle(.white).lineLimit(2)
                    if let id = model.state?.running == true ? model.state?.track?.ticketID : model.pausedSession?.ticketID {
                        Button { model.showContext(id) } label: { Label("Ticket context #\(String(id))", systemImage: "doc.text.magnifyingglass") }
                            .buttonStyle(.plain).font(.callout).foregroundStyle(.white.opacity(0.9))
                    } else {
                        Text(model.state?.running == true || model.pausedSession != nil ? "No Azure ticket · " + (model.state?.track?.remark ?? model.pausedSession?.remark ?? "") : "Choose a ticket, or switch branches to get a suggestion.")
                            .font(.callout).foregroundStyle(.white.opacity(0.9))
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 15) {
                    TimerDisplay(seconds: model.elapsed(at: context.date), indicator: model.trackingIndicator,
                                 sessionID: model.state?.identity ?? "idle", todaySeconds: model.targetProgress(at: context.date)?.today,
                                 dailyTarget: model.configuration.targets.dailySeconds(on: context.date, calendar: .current),
                                 totalsConfirmed: model.connectionHealth == .confirmed && model.progressIssue == nil,
                                 onDarkBackground: true, fontSize: 40)
                    if model.state?.running == true {
                        HStack {
                            Button { Task { await model.pauseTracking() } } label: { Label("Pause", systemImage: "pause.fill") }
                                
                            Button { Task { await model.stopTracking() } } label: { Label("Stop", systemImage: "stop.fill") }
                        }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(Palette.action).disabled(model.busy || !model.connected)
                    } else if model.pausedSession != nil {
                        Button("Resume tracking…") { model.resumeTracking(inMenuBar: false) }
                            .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(Palette.action).disabled(model.busy || !model.connected)
                    } else {
                        Text("TODAY  \(DurationText.short(model.todaySeconds))").font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.9)).tracking(1)
                    }
                }
            }.padding(30).frame(maxWidth: .infinity, minHeight: 197)
                .background(LinearGradient(colors: [Color(red: 0.06, green: 0.27, blue: 0.29), Color(red: 0.05, green: 0.40, blue: 0.38)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 19))
        }
    }
}

struct BranchPrompt: View {
    @ObservedObject var model: AppModel
    let change: BranchChange
    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(spacing: 9) {
                Image(systemName: "arrow.triangle.branch").foregroundStyle(Palette.accent)
                Text("You switched branches").font(.headline)
                Spacer()
                Text(change.repositoryName).font(.caption).foregroundStyle(Palette.secondary)
            }
            Text(change.branch).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
            Text(change.suggestsBreak ? "This branch suggests pausing or stopping your current timer." : change.ticketID.map { "Track Azure ticket #\($0)? Choose its activity type before starting." } ?? "No unique ticket number found. Choose a ticket or keep your current tracking.")
                .font(.callout).foregroundStyle(Palette.secondary)
            if change.suggestsBreak {
                BranchBreakActions(model: model, change: change)
            } else {
            HStack {
                Button("Keep current tracking") { model.keep(change) }.buttonStyle(.bordered)
                Spacer()
                Button("Choose another ticket") { model.selectedChange = change; model.showTicketPicker = true }.buttonStyle(.plain).foregroundStyle(Palette.accent)
                if let id = change.ticketID {
                    Button("Track #\(String(id))…") { Task { await model.chooseActivity(for: id, change: change) } }
                        .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
                }
            }
            }
        }.padding(21).background(Palette.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.accent.opacity(0.2), lineWidth: 1))
    }
}

struct LogRow: View {
    @ObservedObject var model: AppModel
    let log: WorkLog
    var body: some View {
        HStack(spacing: 13) {
            RoundedRectangle(cornerRadius: 3).fill(Palette.accent.opacity(0.5)).frame(width: 4, height: 32)
            VStack(alignment: .leading, spacing: 5) {
                Text(model.workItems[log.workItemId ?? 0]?.title ?? log.comment?.nonEmpty ?? log.workItemId.map { "Azure ticket #\($0)" } ?? "Unassigned time")
                    .font(.system(size: 13, weight: .medium)).lineLimit(1)
                HStack(spacing: 6) {
                    if let id = log.workItemId { Button("#" + String(id)) { model.showContext(id) }.buttonStyle(.plain).foregroundStyle(Palette.accent).help("Show ticket context") }
                    Text(log.date?.formatted(date: .omitted, time: .shortened) ?? log.timestamp)
                    if let type = log.activityType?.name { Text("· \(type)") }
                }.font(.caption).foregroundStyle(Palette.secondary)
            }
            Spacer()
            Text(DurationText.short(log.length)).font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit()
            if let id = log.workItemId {
                Button { model.selectedChange = nil; Task { await model.chooseActivity(for: id) } } label: { Label("Track again", systemImage: "play.circle") }
                    .help("Track this ticket again").accessibilityLabel("Track ticket #" + String(id) + " again").disabled(model.busy || !model.connected)
            }
        }
    }
}

struct MenuPanel: View {
    @ObservedObject var model: AppModel
    var body: some View {
        ViewThatFits(in: .vertical) {
            panel
            ScrollView { panel }.scrollBounceBehavior(.basedOnSize)
        }.frame(maxHeight: 720)
    }
    private var panel: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Azure timetracker", systemImage: "clock").font(.headline)
                Spacer()
                Label(model.trackingIndicator.label, systemImage: model.trackingIndicator.symbol)
                    .font(.caption).foregroundStyle(Color(nsColor: model.trackingIndicator.tint))
            }
            if model.menuTracking {
                if let draft = model.trackingDraft { MenuActivityPicker(model: model, draft: draft) }
                else { MenuTicketPicker(model: model) }
            } else {
                Divider()
                Text("Current tracking").font(.headline).accessibilityAddTraits(.isHeader)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    TimerDisplay(seconds: model.elapsed(at: context.date), indicator: model.trackingIndicator,
                                 sessionID: model.state?.identity ?? "idle", todaySeconds: model.targetProgress(at: context.date)?.today,
                                 dailyTarget: model.configuration.targets.dailySeconds(on: context.date, calendar: .current),
                                 totalsConfirmed: model.connectionHealth == .confirmed && model.progressIssue == nil)
                }
                if model.state?.running == true {
                    VStack(alignment: .leading, spacing: 6) {
                        if let id = model.state?.track?.ticketID {
                            Button { model.openTicket(id) } label: { Label("#\(String(id))", systemImage: "arrow.up.right") }
                                .buttonStyle(.plain).font(.caption).foregroundStyle(Palette.accent)
                        }
                        Text(model.currentTicketTitle).font(.callout.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                    }
                } else if let paused = model.pausedSession {
                    VStack(alignment: .leading, spacing: 6) {
                        Text((paused.ticketID.map { "#\($0) · " } ?? "") + model.pausedTicketTitle).font(.callout.weight(.medium))
                        Text("Paused · no new time is logged").font(.caption).foregroundStyle(Palette.secondary)
                    }
                } else { Text("No timer running").font(.callout).foregroundStyle(Palette.secondary) }
                HStack {
                    if model.pausedSession != nil && model.state?.running != true {
                        Button("Resume…") { model.resumeTracking() }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
                        Button("Clear pause") { model.discardPause() }.disabled(model.busy)
                    } else {
                    Button(model.state?.running == true ? "Switch ticket…" : "Start tracking…") { model.quickSwitch() }
                        .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
                    }
                    Spacer()
                    if model.state?.running == true {
                        Button("Pause") { Task { await model.pauseTracking() } }
                            .disabled(model.busy || !model.connected)
                        Button("Stop") { Task { await model.stopTracking() } }.disabled(model.busy || !model.connected)
                    }
                }
                if let prompt = model.trackingAttention { TrackingAttentionPrompt(model: model, prompt: prompt) }
                TargetProgressView(model: model, compact: true)
                if model.reviewPromptDay != nil { Divider(); DayReviewPrompt(model: model) }
                if model.meetingReturnReady {
                    Divider()
                    MeetingReturnPrompt(model: model)
                }
                if let microphoneSession = model.pendingMicrophoneSessions.first { Divider(); MicrophonePrompt(model: model, microphoneSession: microphoneSession) }
                if let meeting = model.pendingMeetings.first {
                    Divider()
                    MeetingPrompt(model: model, meeting: meeting)
                    if model.pendingMeetings.count > 1 {
                        Text("\(model.pendingMeetings.count - 1) more meeting suggestions in Overview").font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
                if let change = model.pending.last {
                    Divider()
                    VStack(alignment: .leading, spacing: 10) {
                        Label("New branch suggestion", systemImage: "arrow.triangle.branch").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
                        Text(change.repositoryName + " · " + change.branch).font(.caption).foregroundStyle(Palette.secondary).lineLimit(2)
                        if change.suggestsBreak {
                            Text("Pause or stop for this branch.").font(.callout)
                            BranchBreakActions(model: model, change: change)
                        } else {
                        if let id = change.ticketID {
                            Text("#\(String(id))").font(.caption.weight(.semibold))
                            if let item = model.workItems[id] { Text(item.title).font(.callout).lineLimit(3) }
                        }
                        HStack {
                            Button("Keep current") { model.keep(change) }
                            Spacer()
                            Button(change.ticketID == nil ? "Choose ticket…" : "Choose activity…") {
                                model.beginMenuTracking(change)
                                if model.menuTracking, let id = change.ticketID {
                                    Task { await model.chooseActivity(for: id, change: change, inMenuBar: true) }
                                }
                            }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
                        }
                        }
                        if model.pending.count > 1 { Text("\(model.pending.count - 1) more in Overview").font(.caption).foregroundStyle(Palette.secondary) }
                    }
                }
            }
            if let error = model.error { Text(error).font(.caption).foregroundStyle(Palette.warning).lineLimit(3) }
            ConnectionHealthView(model: model, compact: true)
            Divider()
            Text("Open a section").font(.headline).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                Button { model.page = .overview; model.revealWindow?() } label: { Label("Overview", systemImage: "square.grid.2x2").frame(maxWidth: .infinity, minHeight: 26) }
                Button { model.openDayReview() } label: { Label("Day review", systemImage: "checklist").frame(maxWidth: .infinity, minHeight: 26) }
                Button { model.page = .settings; model.revealWindow?() } label: { Label("Settings", systemImage: "gearshape").frame(maxWidth: .infinity, minHeight: 26) }
                Button { NSApp.terminate(nil) } label: { Label("Quit app", systemImage: "power").frame(maxWidth: .infinity, minHeight: 26) }.help("Quitting leaves the 7pace timer running")
            }
        }.padding(20).background(Palette.card)
    }
}

struct BranchBreakActions: View {
    @ObservedObject var model: AppModel
    let change: BranchChange
    var body: some View {
        HStack {
            Button(model.state?.running == true ? "Keep current" : "Dismiss") { model.keep(change) }
            Spacer()
            if model.state?.running == true {
                Button("Pause") { Task { await model.pauseTracking(for: change) } }
                    .disabled(model.busy || !model.connected)
                Button("Stop") { Task { await model.stopTracking(for: change) } }
                    .buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
            } else { Text("No active timer").font(.caption).foregroundStyle(Palette.secondary) }
        }
    }
}

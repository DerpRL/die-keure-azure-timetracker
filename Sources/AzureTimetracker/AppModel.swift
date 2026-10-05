import AppKit
import AzureTimetrackerCore
import Combine
import ServiceManagement

enum AppPage: String, CaseIterable, Identifiable {
    case overview = "Overview", dayReview = "Day review", agenda = "Agenda", statistics = "Statistics", weeklyReport = "Weekly report", history = "History", timeEditor = "Time editor", repositories = "Repositories", settings = "Settings", figma = "Figma", offlineDrafts = "Offline drafts"
    var id: String { rawValue }
    var symbol: String {
        switch self { case .overview: "square.grid.2x2"; case .dayReview: "checklist"; case .statistics: "chart.bar.xaxis"; case .history: "clock.arrow.circlepath"; case .timeEditor: "square.and.pencil"; case .weeklyReport: "doc.text"; case .agenda: "calendar"; case .repositories: "point.3.connected.trianglepath.dotted"; case .settings: "gearshape"; case .figma: "square.stack.3d.up"; case .offlineDrafts: "internaldrive" }
    }
}

struct TrackingDraft: Identifiable, Sendable {
    let id = UUID()
    let item: WorkItem?
    let change: BranchChange?
    let expectedIdentity: String
    var microphoneSession: MicrophoneSession? = nil
    var attention: TrackingAttention? = nil
    var standup = false
    var manual: ManualTrackingKind? = nil
    var figmaSuggestion: FigmaSuggestion? = nil
    var figmaFile: String? = nil
    var figmaScope: String? = nil
    var figmaName: String? = nil
    var isFigma: Bool { figmaSuggestion != nil || figmaFile != nil }
    var allowsNoTicket: Bool { resume == nil && attention == nil && meetingReturn == nil && microphoneSession == nil && manual == nil }
    var title: String { item?.title ?? figmaName ?? meeting?.title ?? change?.branch ?? attention?.title ?? resume?.remark ?? manual?.label ?? (standup ? "Daily standup" : "Meeting") }
    var remark: String? { figmaName ?? microphoneSession.map { standup ? StandupActivity.remark : "Meeting · " + $0.owner.name } ?? attention?.remark ?? resume?.remark ?? meeting?.title ?? change?.branch }
    func trackingComment(includeTicket: Bool) -> String? { remark ?? (includeTicket ? nil : item?.title) }
    var meeting: MeetingEvent? = nil
    var resume: PausedSession? = nil
    var meetingReturn: MeetingReturn? = nil
}

@MainActor final class AppModel: ObservableObject {
    @Published var configuration: Configuration
    @Published var page: AppPage = .overview
    @Published var state: TrackingState?
    @Published var pending: [BranchChange]
    @Published var audit: [AuditEntry]
    @Published var branches: [UUID: GitSnapshot] = [:]
    @Published var repositoryErrors: [UUID: String] = [:]
    @Published var logs: [WorkLog] = []
    @Published var todayLogs: [WorkLog] = []
    @Published var workItems: [Int: WorkItem] = [:]
    @Published var activityTypes: [ActivityType] = []
    @Published var activityTypesLoaded = false
    @Published var loadingActivities = false
    @Published var activityError: String?
    @Published var trackingDraft: TrackingDraft?
    @Published var error: String?
    @Published var notice: String?
    @Published var busy = false
    @Published var loadingHistory = false
    @Published var connected = false
    @Published var connecting = false
    @Published var pausedSession: PausedSession?
    @Published var lastSync: Date?
    @Published var connectionHealth: ConnectionHealth = .unconfigured
    @Published var connectionIssue: String?
    @Published var azureIssue: String?
    @Published var progressIssue: String?
    @Published var progressLogs: [WorkLog] = []
    @Published var progressLastSync: Date?
    @Published var progressWeek: DateInterval?
    @Published var loadingProgress = false
    @Published var meetingReturn: MeetingReturn?
    @Published var quickTickets = QuickTickets(workspace: "")
    @Published var shortcutIssue: String?
    private var connectionFailure: AppError?
    private var lastProgressCheck = Date.distantPast
    private var quickSwitchPending = false
    @Published var historyLoaded = false
    @Published var showTicketPicker = false
    @Published var menuTracking = false
    @Published var selectedChange: BranchChange?
    @Published var selectedMeeting: MeetingEvent?
    @Published var pendingMeetings: [MeetingEvent] = []
    @Published var pendingMicrophoneSessions: [MicrophoneSession] = []
    let figma = FigmaService()
    @Published var figmaStore = FigmaStore()
    @Published var figmaStorageIssue: String?
    @Published var selectedFigmaSuggestion: FigmaSuggestion?
    var skipFigmaPrefill = false
    var figmaActivation = FigmaActivation()
    var currentFigmaScope = ""
    let microphone = MicrophoneService()
    @Published var microphoneTracking = MicrophoneTrackingMonitor()
    private var slackReminders: [String: Date] = [:]
    private var microphonePopupPending = false
    @Published var searchResults: [WorkItem] = []
    @Published var searching = false
    @Published var searchError: String?
    @Published var historyFrom = Calendar.current.date(byAdding: .day, value: -6, to: Calendar.current.startOfDay(for: Date()))!
    @Published var historyTo = Date()
    @Published var notificationAuthorized = false
    @Published var loginEnabled = SMAppService.mainApp.status == .enabled
    @Published var hasAzurePAT = false
    @Published var hasSevenPaceToken = false
    let calendar = CalendarService()
    let interface = InterfaceController()
    @Published private(set) var showAppearanceOnboarding = false
    let updates = AppUpdateModel()
    let statistics = StatisticsModel()
    let offlineDrafts = OfflineDraftModel()
    private var offlineObservation: AnyCancellable?
    var showsLocalTimer: Bool { LocalTimerDisplay.isPrimary(local: offlineDrafts.active, remoteRunning: state?.running == true, remoteConfirmed: connected && connectionHealth == .confirmed) }
    func menuElapsed(at date: Date) -> Double {
        if showsLocalTimer, let draft = offlineDrafts.active { return LocalTimerDisplay.elapsed(draft, at: date) }
        return elapsed(at: date)
    }
    let dayReview = DayReviewModel()
    let pinPairing = PinPairingModel()
    let timeEditor = TimeEditorModel()
    let ticketContext = TicketContextModel()
    let weeklyReport = WeeklyReportModel()
    @Published var contextRequest: TicketContextRequest?
    @Published var workAwareness = WorkAwarenessLedger()
    @Published var forgottenTimer = ForgottenTimerMonitor()
    private let presence = WorkPresenceService()
    private var awarenessAnnounced: UUID?
    private var forgottenAnnounced: UUID?
    @Published var ticketCompletion = TicketCompletionMonitor()
    @Published var ticketCompletionIssue: String?
    @Published var ticketCompletionCheckedAt: Date?
    private var lastCompletionCheck = Date.distantPast
    private var checkingCompletion = false
    @Published var trackingAttention: TrackingAttention?
    private var attentionNotified: [String: Date] = [:]
    private var attentionDismissed: [String: Date] = [:]
    private var attentionPopupPending = false
    @Published var reviewPromptDay: Date?
    @Published private(set) var dayReviews: [String: DayReviewRecord] = [:]
    let notifications = NotificationService()
    let store = LocalStore()
    #if UI_PREVIEW
    let preview = true
    #else
    let preview = ProcessInfo.processInfo.arguments.contains("--preview")
    #endif
    private let transport = HTTPTransport()
    private var api: SevenPaceAPI?
    private var azure: AzureAPI?
    private var debouncer = BranchDebouncer()
    private var loop: Task<Void, Never>?
    private var lastRemoteCheck = Date.distantPast
    private var lastCalendarCheck = Date.distantPast
    private var lastHistoryCheck = Date.distantPast
    private var searchGeneration = UUID()
    private var canPersist = true
    private var historyGeneration = UUID()
    private var connectionGeneration = UUID()
    private var discoverOnStart = false
    private var loadingTicketIDs: Set<Int> = []
    private var menuTrackingGeneration = UUID()
    private var meetingEngine = MeetingSuggestionEngine()
    private var meetingPopupPending = false
    var revealWindow: (() -> Void)?
    var revealSuggestion: (() -> Void)?
    var dismissMenuPanel: (() -> Void)?

    var trackingIndicator: TrackingIndicator {
        if connected, connectionHealth == .confirmed, trackingAttention != nil { return .attention }
        return .resolve(connected: connected && connectionHealth == .confirmed, connecting: connecting, state: state, paused: pausedSession != nil)
    }

    private var workspaceIdentity: String { (try? Endpoint.sevenPace(configuration.sevenPaceURL).absoluteString.lowercased()) ?? "" }
    var pausedTicketTitle: String {
        guard let pausedSession else { return "Paused" }
        return pausedSession.ticketID.map { workItems[$0]?.title ?? "Azure ticket #\($0)" } ?? pausedSession.remark ?? "Paused tracking"
    }

    var currentTicketTitle: String {
        if let id = state?.track?.ticketID, let item = workItems[id] { return item.title }
        return state?.track?.title ?? "Tracking"
    }

    init() {
        var initial = SavedState()
        var loadError: String?
        var hasSavedSettings = false
        do {
            if let saved = try store.load() { initial = saved; hasSavedSettings = true }
            else { discoverOnStart = true }
        } catch {
            loadError = "Saved settings could not be read. The original file has been preserved: \(error.localizedDescription)"
            canPersist = false
        }
        configuration = initial.configuration; pending = initial.pending; audit = initial.audit
        showAppearanceOnboarding = loadError == nil && InterfacePreferences.needsOnboarding(hasSavedSettings: hasSavedSettings, completed: configuration.interfaceSetupCompleted)
        configuration.interfaceSetupCompleted = !showAppearanceOnboarding
        interface.apply(configuration.interface)
        if preview { showAppearanceOnboarding = false }
        pausedSession = initial.pausedSession
        meetingReturn = initial.meetingReturn
        workAwareness = initial.workAwareness ?? WorkAwarenessLedger()
        ticketCompletion = initial.ticketCompletion ?? TicketCompletionMonitor()
        microphoneTracking = initial.microphoneTracking ?? MicrophoneTrackingMonitor()
        if initial.microphoneTracking == nil, let plan = initial.meetingReturn,
           let sessionID = plan.microphoneSessionID, let appID = plan.microphoneAppID, plan.end == Date.distantFuture {
            let session = MicrophoneSession(id: sessionID, owner: MicrophoneOwner(id: appID, name: MicrophoneApp.classify(appID).label), started: Date())
            microphoneTracking.restore(MicrophoneTrackingLink(session: session, workspace: plan.workspace, trackingIdentity: plan.meetingIdentity))
        }
        microphoneTracking.restrict(to: configuration.microphone.apps, workspace: workspaceIdentity)
        quickTickets = initial.quickTickets ?? QuickTickets(workspace: workspaceIdentity)
        if quickTickets.workspace != workspaceIdentity { quickTickets = QuickTickets(workspace: workspaceIdentity) }
        if meetingReturn?.workspace != workspaceIdentity { meetingReturn = nil }
        if pausedSession?.workspace != workspaceIdentity { pausedSession = nil }
        meetingEngine = MeetingSuggestionEngine(seen: initial.meetingReminders ?? [:])
        slackReminders = initial.slackReminders ?? [:]
        dayReviews = initial.dayReviews ?? [:]
        attentionNotified = initial.attentionNotified ?? [:]
        attentionDismissed = initial.attentionDismissed ?? [:]
        figmaStore = initial.figmaStore ?? FigmaStore()
        figma.observed = { [weak self] result, date in self?.observeFigma(result, at: date) }
        microphone.changed = { [weak self] in self?.syncMicrophone() }
        error = loadError
        offlineDrafts.configure(nil, workspace: workspaceIdentity)
        offlineObservation = offlineDrafts.objectWillChange.receive(on: RunLoop.main).sink { [weak self] in self?.objectWillChange.send() }
        offlineDrafts.didSync = { [weak self] in
            guard let self else { return }
            self.statistics.invalidate(); self.dayReview.invalidate()
            Task { await self.loadHistory(); await self.loadProgress() }
        }
        notifications.action = { [weak self] action, id in
            guard let self, let change = self.pending.first(where: { $0.id == id }) else { return }
            if action == "keep" { self.keep(change) }
            else {
                self.page = .overview; self.selectedChange = change
                self.revealWindow?()
                if change.ticketID == nil && !change.suggestsBreak { self.showTicketPicker = true }
            }
        }
        notifications.figmaAction = { [weak self] action, id in
            guard let self, let proposal = self.figmaSuggestions.first(where: { $0.id == id }) else { return }
            if action == "figma-keep" { self.keepFigma(proposal) }
            else { self.beginFigmaTracking(proposal, useLinkedTicket: action != "figma-other") }
        }
        notifications.issue = { [weak self] message in self?.error = message }
        notifications.openDayReview = { [weak self] in self?.openDayReview() }
        notifications.openTrackingAttention = { [weak self] in
            guard let self else { return }; self.page = .overview; self.revealWindow?()
        }
        if preview { notice = "Preview mode · no network requests or tracking changes" }
        #if UI_PREVIEW
        prepareInterfacePreview()
        showAppearanceOnboarding = ProcessInfo.processInfo.arguments.contains("--preview-onboarding")
        interface.apply(configuration.interface)
        discoverOnStart = false
        #endif
    }

    nonisolated static func discoverRepositories() -> [Repository] {
        let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/repositories")
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
        return folders.filter { FileManager.default.fileExists(atPath: $0.appendingPathComponent(".git").path) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }.map { Repository(path: $0.path) }
    }

    func start() {
        guard loop == nil, !showAppearanceOnboarding else { return }
        updates.start(preview: preview, automatic: configuration.checksForUpdates)
        if discoverOnStart {
            discoverOnStart = false
            // Documents access can wait for a macOS permission dialog. Never
            // perform discovery while SwiftUI is constructing its first window.
            Task { [weak self] in
                let repositories = await Task.detached(priority: .utility) { Self.discoverRepositories() }.value
                guard let self else { return }
                for repository in repositories where !configuration.repositories.contains(where: { $0.path == repository.path }) {
                    configuration.repositories.append(repository)
                }
                persist()
            }
        }
        configureMicrophone(); configureFigma()
        if !preview { presence.changed = { [weak self] in self?.checkWorkAwareness() }; presence.start() }
        loop = Task { [weak self] in
            guard let self else { return }
            if !preview { await connect() }
            while !Task.isCancelled {
                await scanBranches()
                if !preview, api != nil, !busy, Date().timeIntervalSince(lastRemoteCheck) >= Double(configuration.pollSeconds) {
                    await refresh()
                }
                if Date().timeIntervalSince(lastCalendarCheck) > 30 {
                    refreshCalendar(); lastCalendarCheck = Date()
                }
                updateConnectionHealth()
                showTrackingAttentionIfReady()
                checkMeetingSuggestions()
                syncMicrophone()
                checkMeetingReturn()
                if !preview, !busy { await checkTicketCompletion() }
                showTicketCompletionIfReady()
                await checkDayReview()
                if quickSwitchPending, !busy { quickSwitchPending = false; quickSwitch() }
                if !preview, connected, !busy, !loadingProgress,
                   (Date().timeIntervalSince(lastProgressCheck) > 300 || (progressWeek != TargetProgress.weekInterval(at: Date()) && Date().timeIntervalSince(lastProgressCheck) > 30)) {
                    await loadProgress()
                }
                if page == .statistics, !preview, connected, !busy { await statistics.load() }
                if page == .dayReview, !preview, connected, !busy { await dayReview.load() }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    @discardableResult func persist() -> Bool {
        guard canPersist, !preview else { return false }
        do { try store.save(SavedState(configuration: configuration, audit: audit, pending: pending, meetingReminders: meetingEngine.seen, pausedSession: pausedSession, meetingReturn: meetingReturn, workAwareness: workAwareness, ticketCompletion: ticketCompletion, microphoneTracking: microphoneTracking, quickTickets: quickTickets, slackReminders: slackReminders, dayReviews: dayReviews, attentionNotified: attentionNotified, attentionDismissed: attentionDismissed, figmaStore: figmaStore)); return true }
        catch { self.error = "Could not save local settings: \(error.localizedDescription)"; return false }
    }
    func setInterfacePreferences(_ preferences: InterfacePreferences) {
        let previous = configuration.interface
        configuration.interface = preferences
        if !preview, !persist() { configuration.interface = previous; return }
        interface.apply(preferences)
    }
    func finishAppearanceOnboarding() {
        figma.refreshPermission()
        guard !configuration.figma.enabled || figma.hasAccess else { error = "Allow Accessibility for Figma detection, or turn Figma detection off to continue."; return }
        configuration.interfaceSetupCompleted = true
        if !preview, !persist() { configuration.interfaceSetupCompleted = false; return }
        showAppearanceOnboarding = false
        page = .settings
        start()
    }
    func installUpdate() {
        guard !busy, !timeEditor.working, !offlineDrafts.working, !pinPairing.busy, !preview else {
            updates.reportInstallFailure(AppError.message("Wait for the current save or connection operation to finish before restarting.")); return
        }
        guard persist() else {
            updates.reportInstallFailure(AppError.message("Local settings could not be saved. Resolve the storage error before updating.")); return
        }
        do { try updates.installAndRestart() } catch { updates.reportInstallFailure(error) }
    }
    func record(_ title: String, _ detail: String) {
        audit.insert(AuditEntry(title, detail: detail), at: 0)
        if audit.count > 2000 { audit = Array(audit.prefix(2000)) }
        persist()
    }

    func connect() async {
        guard !busy, !offlineDrafts.working, !preview else { return }
        busy = true; connecting = true; updateConnectionHealth(); defer { busy = false; connecting = false; updateConnectionHealth() }
        connectionGeneration = UUID(); historyGeneration = UUID(); loadingHistory = false
        statistics.configure(nil)
        offlineDrafts.configure(nil, workspace: workspaceIdentity)
        ticketContext.configure(nil); contextRequest = nil; weeklyReport.configure(nil)
        timeEditor.configure(nil); trackingAttention = nil; attentionPopupPending = false; notifications.removeTrackingAttention()
        dayReview.configure(nil); reviewPromptDay = nil
        if ticketCompletion.pending?.scope != completionScope || !configuration.completionRemindersEnabled { ticketCompletion.clearPrompt() }
        ticketCompletionIssue = nil; ticketCompletionCheckedAt = nil; lastCompletionCheck = .distantPast
        workAwareness.scope(to: workspaceIdentity); forgottenTimer.reset()
        api = nil; azure = nil; state = nil; connected = false; lastSync = nil
        logs = []; todayLogs = []; progressLogs = []; progressLastSync = nil; progressWeek = nil; loadingProgress = false; historyLoaded = false; workItems = [:]; activityTypes = []
        trackingDraft = nil; showTicketPicker = false; menuTracking = false; loadingTicketIDs = []; selectedMeeting = nil
        selectedFigmaSuggestion = nil; skipFigmaPrefill = false
        microphoneTracking.restrict(to: configuration.microphone.apps, workspace: workspaceIdentity)
        if pausedSession?.workspace != workspaceIdentity { pausedSession = nil; persist() }
        if meetingReturn?.workspace != workspaceIdentity { meetingReturn = nil; persist() }
        if quickTickets.workspace != workspaceIdentity { quickTickets = QuickTickets(workspace: workspaceIdentity); persist() }
        connectionFailure = nil; connectionIssue = nil; azureIssue = nil; progressIssue = nil
        activityTypesLoaded = false; activityError = nil
        hasAzurePAT = false; hasSevenPaceToken = false
        guard configuration.sevenPaceURL.nonEmpty != nil else { return }
        do {
            let base = try Endpoint.sevenPace(configuration.sevenPaceURL)
            let client: SevenPaceAPI
            if configuration.sevenPaceAuthMode == .mobilePIN {
                let scope = base.host!
                guard let credentials = try SecretStore.readOAuth(scope: scope) else {
                    throw AppError.message("Pair this Mac with a mobile PIN in Settings → Accounts.")
                }
                let oauth = try SevenPaceOAuth(workspace: base, transport: transport)
                let provider = SevenPaceTokenProvider(tokens: credentials, oauth: oauth) { next, previous in
                    try await SecretStore.renewOAuth(next, replacing: previous, scope: scope)
                }
                client = SevenPaceAPI(baseURL: base, tokenProvider: provider, transport: transport)
            } else {
                guard let token = try SecretStore.read(SecretStore.account(kind: "7pace", scope: base.host!)), !token.isEmpty else {
                    throw AppError.message("Pair with a mobile PIN or add your 7pace API token in Settings → Accounts.")
                }
                client = SevenPaceAPI(baseURL: base, token: token, transport: transport)
            }
            hasSevenPaceToken = true
            if let org = configuration.organization.nonEmpty {
                let url = try Endpoint.azure(org)
                if let pat = try SecretStore.read(SecretStore.account(kind: "azure", scope: org)), !pat.isEmpty {
                    azure = AzureAPI(organizationURL: url, project: configuration.project, pat: pat, transport: transport)
                    hasAzurePAT = true
                }
            }
            api = client
            offlineDrafts.configure(client, workspace: workspaceIdentity)
            statistics.configure(client, targets: configuration.targets)
            timeEditor.configure(client)
            ticketContext.configure(azure); weeklyReport.configure(client)
            dayReview.configure(client)
            apply(try await client.current()); error = nil
            notice = "Connected to \(base.host!)"
            await refreshActivities()
            await loadHistory()
            await loadProgress()
        } catch { fail(error) }
        lastRemoteCheck = Date()
    }

    func refresh() async {
        guard let api, !busy, !preview else { return }
        busy = true; defer { busy = false }; lastRemoteCheck = Date()
        do {
            let oldIdentity = state?.identity
            apply(try await api.current()); error = nil
            if oldIdentity != state?.identity || Date().timeIntervalSince(lastHistoryCheck) > 300 { await loadHistory() }
        } catch { fail(error) }
    }

    private func apply(_ next: TrackingState) {
        if let old = state?.timestamp, let new = next.timestamp, new < old { return }
        if state?.identity != next.identity { statistics.invalidate(); dayReview.invalidate() }
        if state?.identity != next.identity { ticketCompletionCheckedAt = nil; lastCompletionCheck = .distantPast }
        let previousCompletion = ticketCompletion
        ticketCompletion.reconcile(next, scope: completionScope)
        if ticketCompletion != previousCompletion { persist() }
        let previousAwareness = workAwareness
        workAwareness.idle.reconcile(IdleTrackingSession(state: next, confirmedAt: Date()))
        if previousAwareness != workAwareness { persist() }
        if next.running { if forgottenTimer.pending != nil { notifications.removeAwareness() }; forgottenTimer.reset() }
        state = next; connected = true; lastSync = Date()
        updateTrackingAttention(next)
        connectionFailure = nil; connectionIssue = nil; updateConnectionHealth()
        if let plan = meetingReturn, !plan.isValid(state: next, workspace: workspaceIdentity, now: Date()) {
            meetingReturn = nil; persist()
        }
        let previousMicrophone = microphoneTracking
        microphoneTracking.reconcile(state: next, workspace: workspaceIdentity)
        if previousMicrophone != microphoneTracking { persist() }
        syncMicrophone()
        if next.running, pausedSession != nil { pausedSession = nil; persist() }
        if let item = next.track?.workItem { workItems[item.id] = item }
        if let id = next.track?.ticketID { Task { await loadTicketTitle(id) } }
        if let id = pausedSession?.ticketID { Task { await loadTicketTitle(id) } }
        if let warning = next.trackSettings?.responseMessage?.nonEmpty { notice = warning }
    }

    private var completionScope: String { workspaceIdentity + "|" + configuration.organization.lowercased() }
    var ticketCompletionPrompt: TicketCompletionPrompt? {
        guard configuration.completionRemindersEnabled, connected, connectionHealth == .confirmed,
              let prompt = ticketCompletion.pending, prompt.matches(state, scope: completionScope),
              preview || (ticketCompletionCheckedAt.map { Date().timeIntervalSince($0) < 150 } ?? false) else { return nil }
        return prompt
    }
    func checkTicketCompletion(force: Bool = false) async {
        guard !preview, configuration.completionRemindersEnabled, let azure, connected, connectionHealth == .confirmed,
              let tracked = state, tracked.running, let id = tracked.track?.ticketID, id > 0, !checkingCompletion,
              force || Date().timeIntervalSince(lastCompletionCheck) >= 60 else { return }
        let generation = connectionGeneration, scope = completionScope
        checkingCompletion = true; lastCompletionCheck = Date()
        defer { checkingCompletion = false }
        do {
            let status = try await azure.ticketWorkflow(id: id)
            guard generation == connectionGeneration, state?.identity == tracked.identity, state?.running == true,
                  connected, configuration.completionRemindersEnabled else { return }
            ticketCompletion.observe(status, tracking: state, scope: scope, confirmed: connectionHealth == .confirmed)
            ticketCompletionIssue = nil; ticketCompletionCheckedAt = Date(); persist()
        } catch {
            guard generation == connectionGeneration, state?.identity == tracked.identity else { return }
            ticketCompletionIssue = error.localizedDescription; ticketCompletionCheckedAt = nil
        }
    }
    func showTicketCompletionIfReady() {
        guard let prompt = ticketCompletionPrompt, !prompt.notified, !busy, !showTicketPicker, !menuTracking, trackingDraft == nil else { return }
        ticketCompletion.markNotified(); persist(); revealSuggestion?()
    }
    func keepCompletedTicket() {
        guard ticketCompletionPrompt != nil else { return }
        ticketCompletion.keepTracking(); persist()
    }
    private func validateTicketCompletion(_ prompt: TicketCompletionPrompt) async throws {
        guard let azure, ticketCompletionPrompt?.id == prompt.id else { throw AppError.remoteChanged }
        let generation = connectionGeneration
        let latest = try await azure.ticketWorkflow(id: prompt.ticketID)
        guard generation == connectionGeneration, prompt.matches(state, scope: completionScope) else { throw AppError.remoteChanged }
        ticketCompletion.observe(latest, tracking: state, scope: completionScope, confirmed: true)
        ticketCompletionCheckedAt = Date(); persist()
        guard latest.completed else { throw AppError.message("This ticket is no longer completed. Your timer is unchanged.") }
    }

    func loadTicketTitle(_ id: Int) async {
        guard !preview, workItems[id] == nil, !loadingTicketIDs.contains(id) else { return }
        let generation = connectionGeneration
        loadingTicketIDs.insert(id)
        defer { if generation == connectionGeneration { loadingTicketIDs.remove(id) } }
        // Metadata must never turn a healthy running timer into a connection error.
        do {
            let item = try await lookup(id)
            guard generation == connectionGeneration else { return }
            workItems[id] = item
        } catch { /* Lookup records credential problems separately from tracking health. */ }
    }
    private func fail(_ error: Error) {
        self.error = error.localizedDescription; connectionIssue = error.localizedDescription
        connectionFailure = error as? AppError; connected = false; updateConnectionHealth()
    }

    func saveSettings(_ draft: Configuration, pat: String, token: String) async -> Bool {
        guard !busy, !offlineDrafts.working, !preview else { return false }
        do {
            guard draft.awareness.isValid else { throw AppError.message("Choose idle and forgotten-timer thresholds between 1 and 120 minutes.") }
            guard draft.dayReview.isValid else { throw AppError.message("Day review needs a finish time after the workday start, at least one selected day, and valid gap/long-entry thresholds.") }
            guard draft.targets.isValid else { throw AppError.message("Each daily target must be between 0 and 24 hours. Use 0 for a day off.") }
            if !draft.meetings.defaultTicket.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                guard let id = Int(draft.meetings.defaultTicket.trimmingCharacters(in: .whitespacesAndNewlines)), id > 0, id <= Int32.max else {
                    throw AppError.message("Enter a valid default meeting ticket number, or leave it empty.")
                }
            }
            _ = try BranchTicket.extract(from: "feature/123-test", pattern: draft.branchPattern)
            if !draft.sevenPaceURL.isEmpty { _ = try Endpoint.sevenPace(draft.sevenPaceURL) }
            if !draft.organization.isEmpty { _ = try Endpoint.azure(draft.organization) }
            if !pat.isEmpty {
                _ = try Endpoint.azure(draft.organization)
                try SecretStore.save(pat, account: SecretStore.account(kind: "azure", scope: draft.organization))
            }
            if !token.isEmpty, draft.sevenPaceAuthMode != .mobilePIN {
                let url = try Endpoint.sevenPace(draft.sevenPaceURL)
                try SecretStore.save(token, account: SecretStore.account(kind: "7pace", scope: url.host!))
            }
            var updated = draft
            // Appearance choices apply immediately; an older Settings draft must not overwrite them.
            updated.figma = configuration.figma
            updated.interface = configuration.interface
            updated.interfaceSetupCompleted = configuration.interfaceSetupCompleted
            configuration = updated
            updates.automaticChecks = draft.checksForUpdates
            // Saving account settings invalidates previous decisions and snapshots.
            notifications.remove(pending.map(\.id)); pending = []; debouncer = BranchDebouncer()
            persist(); refreshCalendar(); configureMicrophone(); configureFigma()
            if draft.notificationsEnabled { notificationAuthorized = await notifications.enable() }
            await connect()
            return true
        } catch { self.error = error.localizedDescription; return false }
    }

    func loadHistory() async {
        guard let api, !loadingHistory, !preview else { return }
        let generation = UUID(); historyGeneration = generation
        loadingHistory = true
        defer { if historyGeneration == generation { loadingHistory = false } }
        let from = Calendar.current.startOfDay(for: historyFrom)
        let to = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: historyTo))!
        guard from < to else { error = "Choose a history end date on or after the start date."; return }
        do {
            let newLogs = try await api.workLogs(from: from, to: to)
            guard historyGeneration == generation else { return }
            logs = newLogs; historyLoaded = true; lastHistoryCheck = Date()
            statistics.invalidate()
            dayReview.invalidate()
            let today = Calendar.current.startOfDay(for: Date())
            if from <= today && to > Date() {
                todayLogs = newLogs.filter { $0.date.map { Calendar.current.isDateInToday($0) } == true }
            } else {
                let currentDay = try await api.workLogs(from: today, to: Calendar.current.date(byAdding: .day, value: 1, to: today)!)
                guard historyGeneration == generation else { return }
                todayLogs = currentDay
            }
        } catch { if historyGeneration == generation { self.error = "History: \(error.localizedDescription)" } }
    }

    func scanBranches() async {
        guard configuration.watchEnabled else { return }
        let repos = configuration.repositories.filter(\.enabled)
        debouncer.retain(Set(repos.map(\.id)))
        // Filesystem reads never block the UI actor.
        let readings = await Task.detached(priority: .utility) {
            repos.map { repo in (repo, Result { try GitProbe.read(path: repo.path) }) }
        }.value
        for (repo, reading) in readings {
            guard configuration.watchEnabled, configuration.repositories.contains(where: { $0.id == repo.id && $0.enabled }) else { continue }
            switch reading {
            case .failure(let error): repositoryErrors[repo.id] = error.localizedDescription
            case .success(let snapshot):
                repositoryErrors[repo.id] = nil; branches[repo.id] = snapshot
                guard let change = debouncer.sample(snapshot, repository: repo.id) else { continue }
                if change.old == nil {
                    // Establish a baseline without a burst of notifications for
                    // every pre-existing checkout. Preserve only still-valid prompts.
                    let stale = pending.filter { $0.repositoryID == repo.id && $0.branch != snapshot.branch }
                    notifications.remove(stale.map(\.id)); pending.removeAll { stale.map(\.id).contains($0.id) }
                    persist(); continue
                }
                let obsolete = pending.filter { $0.repositoryID == repo.id }
                notifications.remove(obsolete.map(\.id)); pending.removeAll { $0.repositoryID == repo.id }
                if let selectedChange, obsolete.contains(where: { $0.id == selectedChange.id }) { cancelMenuTracking() }
                guard let branch = change.new.branch else {
                    record("Detached HEAD", "\(repo.name): tracking unchanged"); continue
                }
                let ticketID = try? BranchTicket.extract(from: branch, pattern: configuration.branchPattern)
                if let ticketID, connected, state?.running == true, ticketID == state?.track?.ticketID { persist(); continue }
                let event = BranchChange(repository: repo, branch: branch, previousBranch: change.old?.branch, ticketID: ticketID)
                pending.append(event); record("Branch changed", "\(repo.name) → \(branch)")
                revealSuggestion?()
                if let ticketID { Task { await loadTicketTitle(ticketID) } }
                if configuration.notificationsEnabled && !preview { await notifications.post(event, running: state?.running == true) }
                if configuration.autoStartWhenIdle, change.old != nil, connected, state?.running == false, let ticketID {
                    await chooseActivity(for: ticketID, change: event, requiresIdle: true, inMenuBar: true)
                }
            }
        }
    }

    func keep(_ change: BranchChange) {
        guard pending.contains(where: { $0.id == change.id }) else { return }
        dismiss(change)
        record("Kept current tracking", "\(change.repositoryName) · \(change.branch)")
    }
    private func dismiss(_ change: BranchChange) {
        pending.removeAll { $0.id == change.id }; notifications.remove([change.id]); persist()
    }
    private func validate(_ change: BranchChange) async throws {
        guard pending.contains(where: { $0.id == change.id }), configuration.watchEnabled,
              let repo = configuration.repositories.first(where: { $0.id == change.repositoryID && $0.enabled }) else {
            throw AppError.message("This branch suggestion is no longer active.")
        }
        let snapshot = try await Task.detached { try GitProbe.read(path: repo.path) }.value
        guard snapshot.branch == change.branch else {
            dismiss(change); throw AppError.message("This repository changed branches again. Review the latest suggestion.")
        }
    }

    func refreshActivities() async {
        guard let api, !loadingActivities, !preview else { return }
        let generation = connectionGeneration
        loadingActivities = true
        defer { loadingActivities = false }
        do {
            let types = try await api.activityTypes()
            guard generation == connectionGeneration else { return }
            activityTypes = types; activityTypesLoaded = true; activityError = nil
            offlineDrafts.cacheActivities(types, workspace: workspaceIdentity)
        } catch {
            guard generation == connectionGeneration else { return }
            activityTypesLoaded = false; activityError = "Could not load activity types: \(error.localizedDescription)"
        }
    }

    func beginMenuTracking(_ change: BranchChange? = nil) {
        guard change?.suggestsBreak != true else { return }
        guard !busy, trackingDraft == nil, !showTicketPicker else { revealWindow?(); return }
        menuTrackingGeneration = UUID(); skipFigmaPrefill = false
        selectedChange = change; selectedMeeting = nil; selectedFigmaSuggestion = nil; searchResults = []; searchError = nil; menuTracking = true
    }

    func cancelMenuTracking() {
        guard menuTracking else { return }
        menuTrackingGeneration = UUID()
        menuTracking = false; trackingDraft = nil; selectedChange = nil; selectedMeeting = nil; selectedFigmaSuggestion = nil
        searchGeneration = UUID(); searching = false; searchResults = []; searchError = nil
    }

    func chooseManualActivity(_ kind: ManualTrackingKind, inMenuBar: Bool) async {
        guard !busy, trackingDraft == nil else { return }
        guard let state, connected else { error = "Connect and refresh 7pace before starting a timer."; return }
        let connection = connectionGeneration, menuGeneration = menuTrackingGeneration
        busy = true; defer { busy = false }
        if !activityTypesLoaded { await refreshActivities() }
        guard connection == connectionGeneration,
              !inMenuBar || (menuTracking && menuGeneration == menuTrackingGeneration),
              inMenuBar || showTicketPicker else { return }
        // Explicitly choosing no ticket must never inherit a branch, meeting or Figma ticket.
        selectedChange = nil; selectedMeeting = nil; selectedFigmaSuggestion = nil
        trackingDraft = TrackingDraft(item: nil, change: nil, expectedIdentity: state.identity,
                                      standup: kind == .standup, manual: kind)
        menuTracking = inMenuBar; showTicketPicker = !inMenuBar; error = nil
    }

    func chooseDifferentWork() {
        guard !busy else { return }
        trackingDraft = nil; selectedFigmaSuggestion = nil; skipFigmaPrefill = true
        searchResults = []; searchError = nil; error = nil
    }

    func chooseSuggestionTicket(_ draft: TrackingDraft) {
        guard !busy, trackingDraft?.id == draft.id else { return }
        selectedChange = draft.change; selectedMeeting = draft.meeting; selectedFigmaSuggestion = draft.figmaSuggestion
        trackingDraft = nil; skipFigmaPrefill = true; searchResults = []; searchError = nil
    }

    var hasSelectedSuggestion: Bool { selectedChange != nil || selectedMeeting != nil || selectedFigmaSuggestion != nil }

    func chooseSuggestionWithoutTicket(inMenuBar: Bool) async {
        await chooseActivity(for: nil, change: selectedChange, inMenuBar: inMenuBar,
                             meeting: selectedMeeting, figmaSuggestion: selectedFigmaSuggestion)
    }

    func canStart(_ draft: TrackingDraft, activityID: String) -> Bool {
        guard activityTypesLoaded, !loadingActivities, !busy, connected,
              activityTypes.isEmpty || activityTypes.contains(where: { $0.id == activityID }) else { return false }
        if draft.isFigma && !activityTypes.contains(where: { $0.id == activityID && DesignActivity.matches($0) }) { return false }
        if draft.standup && !activityTypes.contains(where: { $0.id == activityID && StandupActivity.matches($0) }) { return false }
        return draft.microphoneSession.map { microphone.isActive($0) } ?? true
    }

    func chooseActivity(for ticketID: Int?, change: BranchChange? = nil, requiresIdle: Bool = false, inMenuBar: Bool = false, meeting: MeetingEvent? = nil, resume: PausedSession? = nil, meetingReturn: MeetingReturn? = nil, figmaSuggestion: FigmaSuggestion? = nil, figmaFile: String? = nil) async {
        guard !busy, trackingDraft == nil else { return }
        guard let state, connected else { error = "Connect and refresh 7pace before starting a timer."; page = .settings; return }
        if let ticketID, ticketID <= 0 || ticketID > Int32.max { error = "Enter a valid Azure ticket number."; return }
        if requiresIdle && (state.running || showTicketPicker || menuTracking) { return }
        let proposal = figmaSuggestion ?? (inMenuBar ? selectedFigmaSuggestion : nil)
        let scope = figmaScope
        let connection = connectionGeneration
        let menuGeneration = menuTrackingGeneration
        if inMenuBar { menuTracking = true }
        busy = true; defer { busy = false }
        do {
            try validateFigma(proposal, file: figmaFile, ticket: ticketID, scope: scope)
            if change?.suggestsBreak == true { throw AppError.message("This branch suggests pausing or stopping your current timer.") }
            if let change { try await validate(change) }
            if let meeting { refreshCalendar(); try validateMeeting(meeting) }
            if let resume, pausedSession != resume || state.running { throw AppError.message("This paused session is no longer available.") }
            if let meetingReturn, self.meetingReturn != meetingReturn || !meetingReturn.isDue(state: state, workspace: workspaceIdentity, now: Date()) {
                throw AppError.message("The meeting timer changed. Review your current tracking before returning.")
            }
            var item: WorkItem?
            if let ticketID {
                if preview {
                    guard let cached = workItems[ticketID] else { throw AppError.message("This ticket is not in the isolated preview.") }
                    item = cached
                } else { item = try await lookup(ticketID) }
                workItems[ticketID] = item
            }
            if let change { try await validate(change) }
            if !activityTypesLoaded { await refreshActivities() }
            guard connection == connectionGeneration,
                  !inMenuBar || (menuTracking && menuGeneration == menuTrackingGeneration) else { return }
            if let meeting { try validateMeeting(meeting) }
            try validateFigma(proposal, file: figmaFile, ticket: ticketID, scope: scope)
            if (proposal != nil || figmaFile != nil), DesignActivity.selected(in: activityTypes) == nil {
                throw AppError.message("The Design activity is missing in 7pace. Add or enable Design before starting from Figma.")
            }
            // This step is read-only. The user chooses an activity and explicitly
            // confirms before either timer is changed.
            let figmaName = proposal?.name ?? figmaFile.flatMap { figmaLedger.files[$0]?.name }
            trackingDraft = TrackingDraft(item: item, change: change, expectedIdentity: state.identity, figmaSuggestion: proposal, figmaFile: figmaFile, figmaScope: scope, figmaName: figmaName, meeting: meeting, resume: resume, meetingReturn: meetingReturn)
            selectedChange = change; selectedMeeting = meeting; menuTracking = inMenuBar; showTicketPicker = !inMenuBar; error = nil
        } catch { self.error = error.localizedDescription }
    }

    func startTracking(_ draft: TrackingDraft, activityID: String, comment: String = "", includeTicket: Bool = true) async {
        guard !busy, !preview, let api, connected, trackingDraft?.id == draft.id else { return }
        guard activityTypesLoaded else { error = "Load the activity types before starting your timer."; return }
        busy = true; defer { busy = false }
        do {
            let activity = try ActivityChoice.resolve(activityID, available: activityTypes)
            let ticketID = includeTicket || !draft.allowsNoTicket ? draft.item?.id : nil
            if draft.isFigma && !activityTypes.contains(where: { $0.id == activityID && DesignActivity.matches($0) }) {
                throw AppError.message("Choose Design to start tracking from Figma.")
            }
            try validateFigma(draft.figmaSuggestion, file: draft.figmaFile, ticket: draft.item?.id, scope: draft.figmaScope)
            if draft.standup && !activityTypes.contains(where: { $0.id == activityID && StandupActivity.matches($0) }) {
                throw AppError.message("The Standup activity is required to track daily standup.")
            }
            let remark = draft.manual.map { $0.remark(comment: comment, activity: activityTypes.first { $0.id == activityID }) }
                ?? draft.trackingComment(includeTicket: ticketID != nil)
            if let microphoneSession = draft.microphoneSession {
                try microphone.validateCurrent(microphoneSession)
                guard !draft.standup || activityTypes.contains(where: { $0.id == activityID && StandupActivity.matches($0) }) else {
                    throw AppError.message("Choose the Standup activity before starting daily standup tracking.")
                }
            }
            if let change = draft.change { try await validate(change) }
            if let meeting = draft.meeting { refreshCalendar(); try validateMeeting(meeting) }
            if let resume = draft.resume, pausedSession != resume { throw AppError.message("This paused session is no longer available.") }
            if let plan = draft.meetingReturn, meetingReturn != plan || !plan.isDue(state: state, workspace: workspaceIdentity, now: Date()) {
                throw AppError.message("This meeting return is no longer available.")
            }
            let previous = state
            let previousReturn = meetingReturn
            let next = try await TrackingTransaction.switchTo(ticketID, expectedIdentity: draft.expectedIdentity,
                activityType: activity, remark: remark, expectedAttention: draft.attention, service: api, validateContext: { [weak self] in
                    guard let self else { throw AppError.message("Tracking context is no longer available.") }
                    try await self.validateFigma(draft.figmaSuggestion, file: draft.figmaFile, ticket: draft.item?.id, scope: draft.figmaScope)
                })
            apply(next)
            if let meeting = draft.meeting, let previous {
                meetingReturn = MeetingReturn.afterStarting(meeting: meeting, previous: previous, next: next,
                    workspace: workspaceIdentity, existing: previousReturn)
            } else if let microphoneSession = draft.microphoneSession, let previous {
                let meeting = MeetingEvent(id: "microphone:" + microphoneSession.id, title: draft.title, start: microphoneSession.started, end: .distantFuture)
                meetingReturn = MeetingReturn.afterStarting(meeting: meeting, previous: previous, next: next,
                    workspace: workspaceIdentity, existing: previousReturn)
                meetingReturn?.microphoneSessionID = microphoneSession.id
                meetingReturn?.microphoneAppID = microphoneSession.owner.id
            } else { meetingReturn = nil }
            completeFigmaTracking(draft, ticketID: ticketID)
            if let ticketID { quickTickets.remember(ticketID) }
            if let microphoneSession = draft.microphoneSession { dismissMicrophone(microphoneSession) }
            error = figmaStorageIssue; trackingDraft = nil; showTicketPicker = false; menuTracking = false
            if let change = draft.change { dismiss(change) }
            if let meeting = draft.meeting { dismissMeeting(meeting) }
            selectedMeeting = nil
            let activityName = activityTypes.first { $0.id == activity }?.name ?? "7pace default"
            record("Tracking started", (ticketID.map { "#\($0) · " } ?? "") + (ticketID == nil ? remark ?? draft.title : draft.title) + " · " + activityName)
            await loadHistory()
            await loadProgress()
        } catch {
            let message = error.localizedDescription
            // A timed-out write may still have reached 7pace. Reconcile with a
            // read only; never replay a mutation or manufacture local worklogs.
            do { apply(try await api.current()) } catch { fail(error) }
            self.error = message
            // A later attempt needs a new confirmation based on the refreshed
            // state, especially if stop succeeded but start did not.
            trackingDraft = nil; showTicketPicker = false; menuTracking = false; selectedMeeting = nil
            record("Tracking needs attention", message)
        }
    }

    func stopTracking(for change: BranchChange? = nil, afterMicrophone prompt: MicrophoneEndPrompt? = nil, afterCompletion completion: TicketCompletionPrompt? = nil) async {
        guard !busy, !preview, let api, let state, connected else { return }
        busy = true; defer { busy = false }
        do {
            if let completion { try await validateTicketCompletion(completion) }
            if let prompt { try validateMicrophoneEnd(prompt) }
            if let change { try await validate(change) }
            apply(try await TrackingTransaction.stop(expectedIdentity: completion?.trackingIdentity ?? prompt?.trackingIdentity ?? state.identity, service: api))
            pausedSession = nil
            if let change { dismiss(change) }
            error = nil; record("Tracking stopped", "Stopped the active 7pace timer")
            await loadHistory()
            await loadProgress()
        } catch {
            let message = error.localizedDescription
            do { apply(try await api.current()) } catch { fail(error) }
            self.error = message
        }
    }

    func pauseTracking(for change: BranchChange? = nil, afterMicrophone prompt: MicrophoneEndPrompt? = nil) async {
        guard !busy, !preview, let api, let state, state.running, connected else { return }
        let paused = PausedSession(ticketID: state.track?.ticketID.flatMap { $0 > 0 ? $0 : nil }, activityID: state.track?.activityTypeId, workspace: workspaceIdentity,
                                   pausedAt: Date(), elapsedSeconds: elapsed(at: Date()), remark: state.track?.remark)
        busy = true; defer { busy = false }
        do {
            if let prompt { try validateMicrophoneEnd(prompt) }
            if let change { try await validate(change) }
            apply(try await TrackingTransaction.stop(expectedIdentity: prompt?.trackingIdentity ?? state.identity, service: api))
            pausedSession = paused; error = nil
            if let change { dismiss(change) }
            record("Tracking paused", "No time is logged until you resume")
            await loadHistory()
            await loadProgress()
        } catch {
            let message = error.localizedDescription
            do { apply(try await api.current()) } catch { fail(error) }
            self.error = message
        }
    }

    func resumeTracking(inMenuBar: Bool = true) {
        guard !busy, connected, state?.running == false, let pausedSession, trackingDraft == nil, !showTicketPicker else { return }
        if inMenuBar { beginMenuTracking(); revealSuggestion?() }
        Task {
            if let id = pausedSession.ticketID { await chooseActivity(for: id, inMenuBar: inMenuBar, resume: pausedSession) }
            else if let state, pausedSession.remark?.nonEmpty != nil {
                busy = true; defer { busy = false }
                if !activityTypesLoaded { await refreshActivities() }
                guard self.pausedSession == pausedSession, !inMenuBar || menuTracking else { return }
                trackingDraft = TrackingDraft(item: nil, change: nil, expectedIdentity: state.identity, resume: pausedSession)
                menuTracking = inMenuBar; showTicketPicker = !inMenuBar
            }
        }
    }

    func discardPause() {
        guard !busy, pausedSession != nil else { return }
        pausedSession = nil; persist()
    }

    func confirmActivity() async {
        guard !busy, let api, !preview else { return }
        busy = true; defer { busy = false }
        do { apply(try await api.confirmActivity(expected: trackingAttention)); error = nil }
        catch {
            let message = error.localizedDescription
            do { apply(try await api.current()) } catch { fail(error) }
            self.error = message
        }
    }

    private func attentionKey(_ prompt: TrackingAttention) -> String { workspaceIdentity + "|" + prompt.id }
    private func updateTrackingAttention(_ next: TrackingState) {
        let candidate = TrackingAttention.from(next)
        let nextPrompt = candidate.flatMap { attentionDismissed[attentionKey($0)] == nil ? $0 : nil }
        if trackingAttention?.id != nextPrompt?.id {
            notifications.removeTrackingAttention(); trackingAttention = nextPrompt
            if let nextPrompt, attentionNotified[attentionKey(nextPrompt)] == nil {
                attentionPopupPending = true
            }
        }
        if nextPrompt == nil { attentionPopupPending = false }
    }
    private func showTrackingAttentionIfReady() {
        guard attentionPopupPending, let prompt = trackingAttention, connected, !busy, !showTicketPicker, !menuTracking else { return }
        attentionPopupPending = false
        let cutoff = Date().addingTimeInterval(-30 * 86400)
        attentionNotified = attentionNotified.filter { $0.value > cutoff }
        attentionDismissed = attentionDismissed.filter { $0.value > cutoff }
        attentionNotified[attentionKey(prompt)] = Date(); persist(); revealSuggestion?()
        if configuration.notificationsEnabled, !preview { Task { await notifications.postTrackingAttention(prompt) } }
    }
    func keepAttentionStopped() {
        guard let prompt = trackingAttention, prompt.stopped, !busy else { return }
        attentionDismissed[attentionKey(prompt)] = Date(); trackingAttention = nil; attentionPopupPending = false
        notifications.removeTrackingAttention(); persist()
    }
    func continueTrackingAttention() async {
        guard let prompt = trackingAttention, !busy, !preview, let api, connected, trackingDraft == nil else { return }
        if !prompt.stopped { await confirmActivity(); return }
        busy = true; defer { busy = false }
        let connection = connectionGeneration
        do {
            let current = try await api.current(); apply(current)
            guard TrackingAttention.from(current)?.id == prompt.id else { throw AppError.remoteChanged }
            let item: WorkItem?
            if let id = prompt.ticketID { item = try await lookup(id) }
            else { item = nil; guard prompt.remark?.nonEmpty != nil else { throw AppError.message("The stopped task has no ticket or comment. Choose a task manually.") } }
            if !activityTypesLoaded { await refreshActivities() }
            guard connectionGeneration == connection else { return }
            trackingDraft = TrackingDraft(item: item, change: nil, expectedIdentity: current.identity, attention: prompt)
            menuTracking = true; revealSuggestion?(); error = nil
        } catch { self.error = error.localizedDescription }
    }
    func checkWorkAwareness(now: Date = Date()) {
        guard !preview else { return }
        updateConnectionHealth(now: now)
        let old = workAwareness
        workAwareness.scope(to: workspaceIdentity)
        let preferences = configuration.awareness
        guard preferences.idleEnabled || preferences.lockEnabled || preferences.forgottenEnabled else {
            workAwareness.idle.dismiss(); forgottenTimer.reset()
            if old != workAwareness { persist() }
            return
        }
        let confirmed = connected && connectionHealth == .confirmed && !connecting
        let meeting = (microphone.fresh && !microphone.selectedInputAppIDs.isEmpty) ||
            (configuration.calendarEnabled && configuration.meetings.enabled && calendar.meetingEvents.contains { $0.isActive(at: now) })
        // Retain pending evidence through a temporary connection outage, but never act on it without revalidation.
        if confirmed {
            workAwareness.idle.observe(now: now, idleSeconds: presence.idleSeconds,
                unavailableSince: presence.unavailableSince, reason: presence.reason,
                session: IdleTrackingSession(state: state, confirmedAt: lastSync), preferences: preferences, meeting: meeting)
        }
        let review = configuration.dayReview
        let workingHours = now >= review.time(review.startMinute, on: now) && now < review.time(review.finishMinute, on: now) &&
            configuration.targets.dailySeconds(on: now, calendar: .current) > 0
        let eligible = preferences.forgottenEnabled && confirmed && state?.running == false && pausedSession == nil &&
            offlineDrafts.active == nil && !meeting && workingHours && presence.unavailableSince == nil && workAwareness.correction == nil
        let app = presence.foregroundApp
        if forgottenTimer.pending == nil || !eligible {
            forgottenTimer.observe(now: now, eligible: eligible && presence.idleSeconds < 60 && preferences.watches(app?.bundleIdentifier),
                appName: app?.localizedName ?? "your work app", minutes: preferences.forgottenMinutes, deferral: workAwareness.deferral)
        }
        if old != workAwareness { persist() }
        guard !busy, !showTicketPicker, !menuTracking, !timeEditor.working, timeEditor.selected == nil,
              !timeEditor.showCorrections, presence.unavailableSince == nil else { return }
        if let prompt = workAwareness.idle.pending, awarenessAnnounced != prompt.id {
            awarenessAnnounced = prompt.id; revealSuggestion?()
            if configuration.notificationsEnabled { Task { await notifications.postAwareness(title: "Review time away", detail: "Keep the recorded time, or pause and review the detected idle interval.") } }
        } else if let prompt = forgottenTimer.pending, forgottenAnnounced != prompt.id {
            forgottenAnnounced = prompt.id; revealSuggestion?()
            if configuration.notificationsEnabled { Task { await notifications.postAwareness(title: "Working without a timer?", detail: "Choose a ticket to start tracking, snooze, or ignore today.") } }
        }
    }
    func keepIdleTime() {
        if workAwareness.correction?.id == workAwareness.idle.pending?.id { workAwareness.correction = nil }
        workAwareness.idle.dismiss(); notifications.removeAwareness(); persist()
    }
    func deferForgottenTimer(untilTomorrow: Bool) {
        if untilTomorrow { workAwareness.deferral.ignoredDay = Date() }
        else { workAwareness.deferral.until = Date().addingTimeInterval(15 * 60) }
        forgottenTimer.reset(); notifications.removeAwareness(); persist()
    }
    var forgottenTickets: [(repository: String, ticket: Int)] {
        configuration.repositories.filter(\.enabled).compactMap { repo in
            guard let branch = branches[repo.id]?.branch,
                  !BranchPolicy.suggestsBreak(branch),
                  let ticket = try? BranchTicket.extract(from: branch, pattern: configuration.branchPattern) else { return nil }
            return (repo.name, ticket)
        }
    }
    func reviewIdleTime(_ prompt: IdlePeriod) async {
        guard !busy, !preview, let api, let state, connected, connectionHealth == .confirmed,
              workAwareness.idle.pending?.id == prompt.id, state.identity == prompt.session.identity else { return }
        busy = true; defer { busy = false }
        let paused = PausedSession(ticketID: state.track?.ticketID, activityID: state.track?.activityTypeId,
            workspace: workspaceIdentity, pausedAt: Date(), elapsedSeconds: elapsed(at: Date()), remark: state.track?.remark)
        do {
            // Save the review before stopping: an interrupted request must not lose the idle interval.
            workAwareness.correction = prompt
            guard persist() else { throw AppError.message("The idle review could not be saved locally. Your timer has not been stopped.") }
            apply(try await TrackingTransaction.stop(expectedIdentity: prompt.session.identity, service: api))
            pausedSession = paused; persist()
            await openIdleCorrection(prompt)
            await loadHistory(); await loadProgress()
        } catch {
            let message = error.localizedDescription
            do { apply(try await api.current()) } catch { fail(error) }
            self.error = message + " Check the timer before continuing; no correction was applied."
        }
    }
    func openIdleCorrection(_ prompt: IdlePeriod) async {
        guard workAwareness.correction?.id == prompt.id, let end = prompt.end else { return }
        cancelMenuTracking(); dismissMenuPanel?(); page = .timeEditor; revealWindow?()
        timeEditor.day = prompt.start
        await timeEditor.prepareIdleCorrection(id: prompt.session.workLogID, start: prompt.start, end: end)
    }
    func discardIdleCorrection() { workAwareness.correction = nil; persist() }

    func saveTimeEdit() async {
        guard !busy, !preview else { return }
        busy = true; defer { busy = false }
        let idleReviewID = timeEditor.idleInterval != nil ? workAwareness.correction?.id : nil
        if await timeEditor.save() {
            if let idleReviewID, workAwareness.correction?.id == idleReviewID { workAwareness.correction = nil; persist() }
            statistics.invalidate(); dayReview.invalidate()
            weeklyReport.invalidate()
            record("Tracked time updated", "Saved a time correction in 7pace")
            await loadHistory(); await loadProgress()
            if page == .timeEditor { await timeEditor.load() }
        } else if timeEditor.requiresReview {
            statistics.invalidate(); dayReview.invalidate(); weeklyReport.invalidate()
            await loadHistory(); await loadProgress()
        }
    }

    func lookup(_ id: Int) async throws -> WorkItem {
        if let azure {
            do { let item = try await azure.workItem(id: id); azureIssue = nil; return item }
            catch {
                if case AppError.authentication = error { azureIssue = error.localizedDescription }
                if case AppError.accessDenied = error { azureIssue = error.localizedDescription }
                throw error
            }
        }
        guard let api else { throw AppError.message("Connect your account in Settings first.") }
        guard let item = try await api.search(String(id)).first(where: { $0.id == id }) else {
            throw AppError.message("Azure ticket #\(id) was not found or is not accessible.")
        }
        return item
    }
    func search(_ query: String) async {
        let generation = UUID(); searchGeneration = generation
        let connection = connectionGeneration
        searchError = nil; searchResults = []
        guard let api, !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        searching = true
        defer { if searchGeneration == generation { searching = false } }
        do {
            let items: [WorkItem]
            if let id = Int(query.trimmingCharacters(in: CharacterSet(charactersIn: "# "))) { items = [try await lookup(id)] }
            else { items = try await api.search(query) }
            guard searchGeneration == generation, connectionGeneration == connection else { return }
            searchResults = items
            for item in items { workItems[item.id] = item }
        } catch { if searchGeneration == generation { searchError = error.localizedDescription } }
    }

    func chooseRepositoryFolder() -> URL? {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.allowsMultipleSelection = false; panel.prompt = "Scan folder"
        panel.message = "Choose a repository or a parent folder. You will select which repositories to watch after the scan."
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/repositories")
        return panel.runModal() == .OK ? panel.url : nil
    }
    func addRepositories(_ paths: [String]) {
        var valid: [String] = []
        for path in paths {
            do { _ = try GitProbe.read(path: path); valid.append(path) }
            catch { self.error = error.localizedDescription }
        }
        configuration.repositories = RepositoryDiscovery.adding(valid, to: configuration.repositories)
        persist()
    }
    func setRepository(_ id: UUID, enabled: Bool) {
        guard let index = configuration.repositories.firstIndex(where: { $0.id == id }) else { return }
        configuration.repositories[index].enabled = enabled
        if !enabled { clearSuggestions(repositoryID: id) }
        persist()
    }
    func removeRepository(_ id: UUID) {
        configuration.repositories.removeAll { $0.id == id }; branches[id] = nil; repositoryErrors[id] = nil
        clearSuggestions(repositoryID: id); persist()
    }
    private func clearSuggestions(repositoryID: UUID) {
        notifications.remove(pending.filter { $0.repositoryID == repositoryID }.map(\.id))
        pending.removeAll { $0.repositoryID == repositoryID }
    }
    func toggleWatching() {
        configuration.watchEnabled.toggle()
        if !configuration.watchEnabled { notifications.remove(pending.map(\.id)); pending = [] }
        debouncer = BranchDebouncer(); configureFigma(); persist()
    }
    func refreshCalendar() {
        calendar.refresh(selectedIDs: configuration.selectedCalendarIDs, enabled: configuration.calendarEnabled && !preview,
                         organization: configuration.organization)
    }

    func checkMeetingSuggestions(now: Date = Date()) {
        guard configuration.calendarEnabled, calendar.authorized, configuration.meetings.enabled, !preview else {
            pendingMeetings = []; meetingPopupPending = false
            if selectedMeeting != nil { cancelMenuTracking() }
            return
        }
        let current = calendar.meetingEvents.filter { $0.isActive(at: now) }
        let valid = pendingMeetings.compactMap { old in current.first { $0.id == old.id } }
        if valid != pendingMeetings { pendingMeetings = valid }
        if let selectedMeeting, !current.contains(where: { $0.id == selectedMeeting.id }) { cancelMenuTracking() }
        let previousLedger = meetingEngine.seen
        let due = meetingEngine.due(events: calendar.meetingEvents, now: now)
        if !due.isEmpty { pendingMeetings.append(contentsOf: due); meetingPopupPending = true }
        if previousLedger != meetingEngine.seen { persist() }
        if meetingPopupPending, !busy, !showTicketPicker, !menuTracking {
            meetingPopupPending = false
            if !pendingMeetings.isEmpty { revealSuggestion?() }
        }
    }

    func meetingTicket(_ meeting: MeetingEvent) -> Int? {
        meeting.ticketID ?? Int(configuration.meetings.defaultTicket.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func beginMeetingTracking(_ meeting: MeetingEvent, useSuggestedTicket: Bool = true) {
        guard !busy, trackingDraft == nil, !showTicketPicker, !menuTracking else { return }
        do { try validateMeeting(meeting) } catch { self.error = error.localizedDescription; return }
        beginMenuTracking(); selectedMeeting = meeting
        revealSuggestion?()
        if useSuggestedTicket {
            Task { await chooseActivity(for: meetingTicket(meeting), inMenuBar: true, meeting: meeting) }
        }
    }

    func dismissMeeting(_ meeting: MeetingEvent) {
        pendingMeetings.removeAll { $0.id == meeting.id }
    }

    private func validateMeeting(_ meeting: MeetingEvent) throws {
        guard configuration.calendarEnabled, calendar.authorized, configuration.meetings.enabled,
              pendingMeetings.contains(where: { $0.id == meeting.id }),
              calendar.meetingEvents.contains(where: { $0.id == meeting.id && $0.isActive(at: Date()) }) else {
            throw AppError.message("This meeting suggestion has ended or is no longer available.")
        }
    }

    func preferredActivityID(for draft: TrackingDraft) -> String {
        if draft.isFigma { return DesignActivity.selected(in: activityTypes) ?? "" }
        if draft.standup { return StandupActivity.selected(in: activityTypes) ?? "" }
        if draft.microphoneSession != nil || draft.manual == .meeting {
            return MeetingActivity.suggestedID(title: "Meeting", preferredID: configuration.meetings.activityTypeID, available: activityTypes) ?? ""
        }
        if let plan = draft.meetingReturn { return plan.activityID ?? "" }
        if let attention = draft.attention { return attention.activityID ?? "" }
        if let resume = draft.resume { return resume.activityID ?? "" }
        if let meeting = draft.meeting {
            return MeetingActivity.suggestedID(title: meeting.title, preferredID: configuration.meetings.activityTypeID,
                                               available: activityTypes) ?? ""
        }
        return configuration.activityTypeID
    }
    func updateConnectionHealth(now: Date = Date()) {
        connectionHealth = .resolve(configured: hasSevenPaceToken, connecting: connecting, connected: connected,
            lastSync: lastSync, failure: connectionFailure, now: now, pollSeconds: configuration.pollSeconds)
    }

    func retryConnection() async {
        if api == nil || connectionHealth == .authentication || connectionHealth == .accessDenied { await connect() }
        else { await refresh(); if connected { await loadProgress() } }
    }

    func loadProgress() async {
        guard let api, !loadingProgress, !preview else { return }
        let generation = connectionGeneration
        let week = TargetProgress.weekInterval(at: Date())
        loadingProgress = true; lastProgressCheck = Date()
        defer { if generation == connectionGeneration { loadingProgress = false } }
        do {
            let fetched = try await api.workLogs(from: week.start, to: week.end)
            guard generation == connectionGeneration else { return }
            progressLogs = fetched; progressWeek = week; progressLastSync = Date(); progressIssue = nil
            // Seed quick switch from actual recent work without storing work-item titles.
            if quickTickets.recent.isEmpty {
                for id in Array(fetched.compactMap(\.workItemId).prefix(30)).reversed() { quickTickets.remember(id) }
                persist()
            }
        } catch {
            guard generation == connectionGeneration else { return }
            progressIssue = error.localizedDescription
        }
    }

    func targetProgress(at now: Date) -> TargetProgress? {
        guard progressLastSync != nil, progressWeek == TargetProgress.weekInterval(at: now) else { return nil }
        return .calculate(logs: progressLogs, state: state, lastSync: lastSync, now: now,
                          extrapolate: connectionHealth == .confirmed)
    }

    var meetingReturnReady: Bool {
        microphoneEndPrompt == nil && meetingReturn?.isDue(state: state, workspace: workspaceIdentity, now: Date()) == true
    }

    func checkMeetingReturn(now: Date = Date()) {
        guard var plan = meetingReturn else { return }
        if configuration.calendarEnabled, calendar.authorized,
           let event = calendar.meetingEvents.first(where: { $0.id == plan.occurrenceID }), !event.cancelled {
            if plan.end != event.end { if event.end > now { plan.notified = false }; plan.end = event.end; meetingReturn = plan; persist() }
        }
        // A disconnected snapshot cannot invalidate a persisted return before reconnecting.
        guard connected else { return }
        guard plan.isValid(state: state, workspace: workspaceIdentity, now: now) else {
            meetingReturn = nil; persist(); return
        }
        if plan.isDue(state: state, workspace: workspaceIdentity, now: now), !plan.notified,
           connectionHealth == .confirmed, microphoneEndPrompt == nil, !busy, !showTicketPicker, !menuTracking {
            plan.notified = true; meetingReturn = plan; persist(); revealSuggestion?()
            Task { await loadTicketTitle(plan.ticketID) }
        }
    }

    func returnAfterMeeting() {
        guard let plan = meetingReturn, plan.isDue(state: state, workspace: workspaceIdentity, now: Date()), !busy, connected, !showTicketPicker, trackingDraft == nil else { return }
        beginMenuTracking(); revealSuggestion?()
        Task { await chooseActivity(for: plan.ticketID, inMenuBar: true, meetingReturn: plan) }
    }

    func dismissMeetingReturn() { meetingReturn = nil; persist() }

    func quickSwitch() {
        guard !busy else { quickSwitchPending = true; revealSuggestion?(); return }
        if showTicketPicker { revealWindow?(); return }
        if !menuTracking { beginMenuTracking() }
        revealSuggestion?()
        Task {
            await prefillFigmaTracking(inMenuBar: true)
            for id in quickTickets.orderedIDs.prefix(12) { await loadTicketTitle(id) }
        }
    }

    func toggleFavorite(_ id: Int) { quickTickets.toggleFavorite(id); persist() }

    var microphoneEndPrompt: MicrophoneEndPrompt? {
        guard configuration.microphone.enabled, let prompt = microphoneTracking.pending,
              prompt.isValid(state: state, workspace: workspaceIdentity) else { return nil }
        if !preview && (!microphone.fresh || !microphone.selectedInputAppIDs.isEmpty || !microphone.engine.sessions.isEmpty) { return nil }
        return prompt
    }
    var canReturnAfterMicrophone: Bool { meetingReturn?.isDue(state: state, workspace: workspaceIdentity, now: Date()) == true }
    private func validateMicrophoneEnd(_ prompt: MicrophoneEndPrompt) throws {
        guard microphoneEndPrompt?.id == prompt.id, connectionHealth == .confirmed else {
            throw AppError.message("This microphone reminder is no longer current. Check the active timer before changing it.")
        }
    }
    func keepTrackingAfterMicrophone() {
        guard microphoneEndPrompt != nil else { return }
        microphoneTracking.dismiss()
        if meetingReturn?.microphoneSessionID != nil { meetingReturn = nil }
        persist()
    }
    func configureMicrophone() {
        guard !preview else { return }
        if !configuration.microphone.enabled {
            pendingMicrophoneSessions = []; microphonePopupPending = false; microphoneTracking.reset(); persist()
        }
        microphoneTracking.restrict(to: configuration.microphone.apps, workspace: workspaceIdentity)
        microphone.configure(configuration.microphone, restoring: microphoneTracking.links.values.map(\.session))
    }

    func syncMicrophone() {
        // A temporary HAL error must not dismiss an existing choice or end a meeting.
        if microphone.fresh {
            pendingMicrophoneSessions = pendingMicrophoneSessions.filter { microphone.isActive($0) }
            if let session = trackingDraft?.microphoneSession, !busy, !microphone.isActive(session) { cancelMenuTracking() }
        }
        let suggestions = microphone.suggestions()
        if !suggestions.isEmpty { pendingMicrophoneSessions.append(contentsOf: suggestions); microphonePopupPending = true }
        if let session = meetingReturn?.microphoneSessionID, microphone.fresh,
           microphone.engine.ended.contains(session), meetingReturn?.end == Date.distantFuture {
            meetingReturn?.end = Date(); persist()
        }
        let previousMonitor = microphoneTracking
        microphoneTracking.observe(sessions: Array(microphone.engine.sessions.values), inputAppIDs: microphone.selectedInputAppIDs,
                                   ended: microphone.engine.ended, state: state, workspace: workspaceIdentity,
                                   fresh: microphone.fresh, confirmed: connected && connectionHealth == .confirmed)
        if let prompt = microphoneEndPrompt, !prompt.notified, connected, connectionHealth == .confirmed,
           !busy, !showTicketPicker, !menuTracking {
            microphoneTracking.markNotified(); revealSuggestion?()
        }
        if microphoneTracking != previousMonitor { persist() }
        if microphonePopupPending, !busy, !showTicketPicker, !menuTracking {
            microphonePopupPending = false
            if !pendingMicrophoneSessions.isEmpty { revealSuggestion?() }
        }
    }

    func dismissMicrophone(_ microphoneSession: MicrophoneSession) { pendingMicrophoneSessions.removeAll { $0.id == microphoneSession.id } }

    func chooseMicrophoneActivity(_ microphoneSession: MicrophoneSession, standup: Bool) async {
        guard !busy, connected, let state, !preview, trackingDraft == nil, !showTicketPicker else { return }
        do { try microphone.validateCurrent(microphoneSession) } catch { self.error = error.localizedDescription; return }
        beginMenuTracking(); revealSuggestion?()
        let generation = menuTrackingGeneration, connection = connectionGeneration
        busy = true; defer { busy = false }
        if !activityTypesLoaded { await refreshActivities() }
        guard menuTracking, menuTrackingGeneration == generation, connection == connectionGeneration else { return }
        do {
            try microphone.validateCurrent(microphoneSession)
            trackingDraft = TrackingDraft(item: nil, change: nil, expectedIdentity: state.identity, microphoneSession: microphoneSession, standup: standup)
        } catch { self.error = error.localizedDescription; cancelMenuTracking() }
    }

    func dayReviewRecord(for day: Date) -> DayReviewRecord? {
        dayReviews[DayReviewSchedule.key(workspace: workspaceIdentity, day: day)]
    }
    func openDayReview() {
        dayReview.selectedDay = Date(); page = .dayReview; revealWindow?()
        Task { await refreshDayReview() }
    }
    func refreshDayReview() async {
        if !busy { await refresh() }
        await dayReview.load(force: true)
    }
    func markDayReviewed(_ day: Date) {
        guard !preview else { return }
        let key = DayReviewSchedule.key(workspace: workspaceIdentity, day: day)
        var record = dayReviews[key] ?? DayReviewRecord()
        record.reviewedAt = Date(); record.snoozedUntil = nil; dayReviews[key] = record
        if Calendar.current.isDateInToday(day) { reviewPromptDay = nil; notifications.removeDayReview() }
        persist()
    }
    func snoozeDayReview() {
        guard !preview, canSnoozeDayReview else { return }
        let now = Date(), key = DayReviewSchedule.key(workspace: workspaceIdentity, day: Date())
        var record = dayReviews[key] ?? DayReviewRecord()
        record.promptedAt = now; record.snoozedUntil = now.addingTimeInterval(30 * 60); record.reviewedAt = nil
        dayReviews[key] = record; reviewPromptDay = nil; notifications.removeDayReview(); persist()
    }
    var canSnoozeDayReview: Bool {
        let now = Date(), preferences = configuration.dayReview
        return preferences.enabled && preferences.weekdays.contains(Calendar.current.component(.weekday, from: now)) &&
            now.addingTimeInterval(30 * 60) < Calendar.current.dateInterval(of: .day, for: now)!.end
    }
    func checkDayReview(now: Date = Date()) async {
        let preferences = configuration.dayReview
        guard !preview, api != nil, preferences.enabled, preferences.isValid,
              preferences.weekdays.contains(Calendar.current.component(.weekday, from: now)),
              configuration.targets.dailySeconds(on: now, calendar: .current) > 0 else {
            if reviewPromptDay != nil { reviewPromptDay = nil }; return
        }
        let day = Calendar.current.startOfDay(for: now), key = DayReviewSchedule.key(workspace: workspaceIdentity, day: now)
        let record = dayReviews[key]
        let pending = DayReviewSchedule.isPending(now: now, record: record) ? day : nil
        if reviewPromptDay != pending { reviewPromptDay = pending }
        guard DayReviewSchedule.isDue(now: now, preferences: preferences, record: record),
              !busy, !showTicketPicker, !menuTracking else { return }
        var next = record ?? DayReviewRecord(); next.promptedAt = now; next.snoozedUntil = nil
        dayReviews = dayReviews.filter { now.timeIntervalSince($0.value.reviewedAt ?? $0.value.promptedAt ?? .distantPast) < 45 * 86400 }
        dayReviews[key] = next; reviewPromptDay = day; persist()
        revealSuggestion?()
        if configuration.notificationsEnabled { await notifications.postDayReview() }
    }
    func showReviewHistory(_ day: Date) {
        historyFrom = day; historyTo = day; page = .history
        Task { await loadHistory() }
    }

    func enableCalendar() async {
        guard !preview else { return }
        await calendar.requestAccess()
        configuration.calendarEnabled = calendar.authorized; persist(); refreshCalendar()
    }
    func setLogin(_ enabled: Bool) {
        guard !preview else { return }
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginEnabled = SMAppService.mainApp.status == .enabled
            if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        } catch { self.error = "Launch at login: \(error.localizedDescription)" }
    }
    func elapsed(at date: Date) -> Double {
        guard let track = state?.track, track.isRunning else { return pausedSession?.elapsedSeconds ?? 0 }
        let base = track.currentTrackLength ?? 0
        return base + (connectionHealth == .confirmed ? max(0, date.timeIntervalSince(lastSync ?? date)) : 0)
    }
    var todaySeconds: Double {
        todayLogs.filter { $0.id != state?.track?.workLogId }.reduce(0) { $0 + $1.length }
    }
    func showContext(_ id: Int) { contextRequest = TicketContextRequest(id: id) }
    func openTicket(_ id: Int) {
        guard let base = try? Endpoint.azure(configuration.organization) else { return }
        NSWorkspace.shared.open(base.appendingPathComponent("_workitems/edit/\(id)"))
    }
    func exportHistory() {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "azure-time-history.csv"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        func escape(_ value: String) -> String {
            let guarded = ["=", "+", "-", "@"].contains(where: { value.hasPrefix($0) }) ? "'" + value : value
            return "\"" + guarded.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        let rows = logs.map { [ $0.timestamp, $0.workItemId.map(String.init) ?? "", workItems[$0.workItemId ?? 0]?.title ?? "", String(Int($0.length)), $0.comment ?? "" ].map(escape).joined(separator: ",") }
        do { try ("Timestamp,Ticket,Title,Seconds,Comment\n" + rows.joined(separator: "\n")).write(to: url, atomically: true, encoding: .utf8) }
        catch { self.error = error.localizedDescription }
    }
}

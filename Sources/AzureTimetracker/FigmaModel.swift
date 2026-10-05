import AppKit
import AzureTimetrackerCore

extension AppModel {
    var figmaScope: String { configuration.organization.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) + "|" + ((try? Endpoint.sevenPace(configuration.sevenPaceURL).absoluteString.lowercased()) ?? "") }
    var figmaLedger: FigmaLedger {
        get { figmaStore.workspaces[figmaScope] ?? FigmaLedger() }
        set {
            guard figmaStore.workspaces[figmaScope] != newValue else { return }
            figmaStore.workspaces[figmaScope] = newValue
            figmaStorageIssue = (!preview && !persist()) ? "Figma context could not be saved on this Mac. Resolve the storage error before quitting." : nil
        }
    }
    var figmaSuggestions: [FigmaSuggestion] {
        guard configuration.figma.enabled, configuration.watchEnabled else { return [] }
        return figmaLedger.suggestions.filter { $0.isFresh(at: Date()) && !($0.ticketID != nil && state?.running == true && $0.ticketID == state?.track?.ticketID) }
    }
    func configureFigma() {
        if currentFigmaScope != figmaScope {
            notifications.remove(figmaStore.workspaces[currentFigmaScope]?.suggestions.map(\.id) ?? [])
            currentFigmaScope = figmaScope; figma.clearFocus(); figmaActivation = FigmaActivation(); selectedFigmaSuggestion = nil
        }
        if !configuration.figma.enabled || !configuration.watchEnabled {
            notifications.remove(figmaLedger.suggestions.map(\.id)); figmaLedger.suggestions = []
            figmaActivation = FigmaActivation(); selectedFigmaSuggestion = nil
        }
        figma.configure(enabled: configuration.figma.enabled, paused: !configuration.watchEnabled, preview: preview)
    }
    func setFigmaPreferences(_ preferences: FigmaPreferences) {
        var valid = preferences
        valid.dismissalMinutes = max(0, min(120, valid.dismissalMinutes)); valid.historyDays = max(1, min(365, valid.historyDays))
        let old = configuration.figma; configuration.figma = valid
        if !preview, !persist() { configuration.figma = old; return }
        configureFigma()
    }
    func observeFigma(_ observation: FigmaObservation, at now: Date) {
        guard configuration.figma.enabled, configuration.watchEnabled else { return }
        let oldIDs = Set(figmaLedger.suggestions.map(\.id))
        var ledger = figmaLedger
        ledger.prune(at: now, preferences: configuration.figma)
        if let file = observation.document {
            ledger.observe(file)
            if figmaActivation.observe(file, at: now) {
                _ = ledger.activate(file, at: now, activeTicket: state?.running == true ? state?.track?.ticketID : nil, preferences: configuration.figma)
            }
        } else { _ = figmaActivation.observe(nil, at: now) }
        if let ticket = state?.running == true ? state?.track?.ticketID : nil { ledger.suggestions.removeAll { $0.ticketID == ticket } }
        figmaLedger = ledger
        let remainingIDs = Set(ledger.suggestions.map(\.id))
        notifications.remove(Array(oldIDs.subtracting(remainingIDs)))
        for proposal in ledger.suggestions where !oldIDs.contains(proposal.id) {
            if !busy, !menuTracking, !showTicketPicker { revealSuggestion?() }
            let scope = figmaScope
            Task {
                if let id = proposal.ticketID { await loadTicketTitle(id) }
                guard scope == figmaScope, figmaSuggestions.contains(where: { $0.id == proposal.id }) else { return }
                if configuration.notificationsEnabled, !preview {
                    await notifications.postFigma(proposal, ticketTitle: proposal.ticketID.flatMap { workItems[$0]?.title })
                    // Withdraw notifications if the proposal changed during permission lookup/delivery.
                    if !figmaSuggestions.contains(where: { $0.id == proposal.id }) { notifications.remove([proposal.id]) }
                }
            }
        }
    }
    func keepFigma(_ suggestion: FigmaSuggestion) {
        figmaLedger.dismiss(suggestion.id, at: Date(), minutes: configuration.figma.dismissalMinutes)
        notifications.remove([suggestion.id])
    }
    func validateFigma(_ proposal: FigmaSuggestion?, file: String?, ticket: Int?, scope: String?) throws {
        guard proposal != nil || file != nil else { return }
        guard scope == figmaScope, configuration.figma.enabled, configuration.watchEnabled else { throw AppError.message("Figma observation was paused, disabled or its workspace changed. Review the current context.") }
        if let proposal { _ = try figmaLedger.validate(proposal.id, at: Date()) }
        else if let file, figmaLedger.links[file] != ticket { throw AppError.message("This Figma file’s ticket link changed. Choose the ticket again.") }
    }
    func beginFigmaTracking(_ proposal: FigmaSuggestion, useLinkedTicket: Bool = true) {
        guard !busy, trackingDraft == nil, !menuTracking, !showTicketPicker else { return }
        do { _ = try figmaLedger.validate(proposal.id, at: Date()) } catch { self.error = error.localizedDescription; return }
        beginMenuTracking(); selectedFigmaSuggestion = proposal; revealSuggestion?()
        if useLinkedTicket, let ticket = proposal.ticketID {
            Task { await chooseActivity(for: ticket, inMenuBar: true, figmaSuggestion: proposal) }
        }
    }
    func prefillFigmaTracking(inMenuBar: Bool) async {
        guard !skipFigmaPrefill, configuration.figma.enabled, configuration.watchEnabled, selectedChange == nil, selectedMeeting == nil,
              selectedFigmaSuggestion == nil, trackingDraft == nil,
              let file = figma.lastFocusedFile, let id = figmaLedger.links[file] else { return }
        await chooseActivity(for: id, inMenuBar: inMenuBar, figmaFile: file)
    }
    func linkFigmaFile(_ key: String, ticketID: Int?) async -> Bool {
        guard !busy else { return false }
        let scope = figmaScope
        busy = true; defer { busy = false }
        do {
            if let ticketID {
                guard ticketID > 0, ticketID <= Int32.max else { throw AppError.message("Enter a valid ticket number.") }
                let item = try await lookup(ticketID)
                guard scope == figmaScope else { throw AppError.message("Workspace changed. Review the link again.") }
                workItems[item.id] = item
            }
            let ids = figmaLedger.suggestions.filter { $0.file == key }.map(\.id)
            var ledger = figmaLedger; try ledger.link(key, to: ticketID); figmaLedger = ledger
            notifications.remove(ids)
            guard figmaStorageIssue == nil else { return false }
            error = nil; return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func completeFigmaTracking(_ draft: TrackingDraft) {
        guard draft.figmaScope == figmaScope, let file = draft.figmaSuggestion?.file ?? draft.figmaFile, let ticket = draft.item?.id else { return }
        let ids = figmaLedger.suggestions.filter { $0.file == file }.map(\.id)
        do { try figmaLedger.link(file, to: ticket); notifications.remove(ids) }
        catch { self.error = error.localizedDescription }
        selectedFigmaSuggestion = nil
    }
    func openFigma(_ key: String, desktop: Bool) {
        do { try figma.open(key, desktop: desktop) } catch { self.error = error.localizedDescription }
    }
    func clearFigmaHistory() { figmaLedger.history = [] }
}

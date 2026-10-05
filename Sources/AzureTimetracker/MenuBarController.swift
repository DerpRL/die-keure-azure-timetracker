import AppKit
import SwiftUI
import Combine
import AzureTimetrackerCore

extension TrackingIndicator {
    @MainActor var tint: NSColor {
        switch self {
        case .running: Palette.adaptive(light: (0.06, 0.42, 0.21), dark: (0.30, 0.88, 0.50))
        case .paused: Palette.warningColor
        case .stopped, .connecting: .labelColor
        case .disconnected, .attention: Palette.warningColor
        }
    }
}

/// AppKit owns presentation so a new branch can open the menu-bar panel.
/// Monospaced timer text keeps the menu item stable as seconds change.
@MainActor final class MenuBarController: NSObject, NSPopoverDelegate {
    private let statusItem: NSStatusItem
    private let popover = NSPopover()
    private let model: AppModel
    private var statusSubscription: AnyCancellable?
    private var timerSubscription: AnyCancellable?
    private var interfaceSubscription: AnyCancellable?
    private var lastStatusDescription = ""

    init(model: AppModel) {
        self.model = model
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        if let button = statusItem.button {
            button.image = Self.menuClock()
            button.imageScaling = .scaleProportionallyDown
            button.imagePosition = .imageLeading
            button.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
            button.title = " 00:00:00"
            button.toolTip = "Azure timetracker"
            button.target = self
            button.action = #selector(toggle)
        }
        let content = NSHostingController(rootView: AppMenuContent(model: model, interface: model.interface))
        content.sizingOptions = [.preferredContentSize]
        popover.contentViewController = content
        popover.behavior = .transient
        popover.delegate = self
        popover.appearance = model.interface.appearance
        interfaceSubscription = model.interface.objectWillChange.receive(on: RunLoop.main).sink { [weak self] in
            guard let self else { return }; popover.appearance = model.interface.appearance
        }
        model.revealSuggestion = { [weak self] in self?.show() }
        model.dismissMenuPanel = { [weak self] in self?.popover.performClose(nil) }
        statusSubscription = Publishers.CombineLatest4(model.$connected, model.$connecting, model.$state, model.$workItems)
            .combineLatest(model.$pausedSession)
            .combineLatest(model.$connectionHealth)
            .sink { [weak self] current, health in
                let (values, paused) = current
                let (connected, connecting, state, items) = values
                guard let self, let button = statusItem.button else { return }
                let status = TrackingIndicator.resolve(connected: connected && health == .confirmed, connecting: connecting, state: state, paused: paused != nil)
                let ticket = state?.track?.ticketID.map { id in
                    "#\(id) · \(items[id]?.title ?? state?.track?.title ?? "Azure ticket")"
                }
                let detail = (state?.running == true ? ticket : paused.map { paused in paused.ticketID.map { "#\($0) · \(items[$0]?.title ?? "Paused ticket")" } ?? paused.remark ?? "Paused tracking" }).map {
                    status == .disconnected ? "Last known: \($0)" : $0
                }
                let description = "Azure timetracker — \(status.label) · \(health.label)" + (detail.map { "\n\($0)" } ?? "")
                guard description != lastStatusDescription else { return }
                lastStatusDescription = description
                button.toolTip = description
                button.setAccessibilityLabel(description)
            }
        timerSubscription = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
            .sink { [weak self] date in
                guard let self, let button = statusItem.button else { return }
                let elapsed = model.menuElapsed(at: date)
                let clock = DurationText.clock(elapsed.isFinite ? min(max(0, elapsed), Double(Int32.max)) : 0)
                button.title = " " + clock
                button.setAccessibilityValue(clock)
                if model.showsLocalTimer, let draft = model.offlineDrafts.active {
                    let label = "Azure timetracker — Local tracking · " + draft.title + " · Not uploaded to 7pace"
                    button.toolTip = label; button.setAccessibilityLabel(label)
                } else {
                    button.toolTip = lastStatusDescription; button.setAccessibilityLabel(lastStatusDescription)
                }
            }
    }

    /// A fixed point-size canvas avoids SF Symbol alignment bounds clipping the status item.
    private static func menuClock() -> NSImage {
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { _ in
            NSColor.black.setStroke()
            let ring = NSBezierPath(ovalIn: NSRect(x: 1.75, y: 1.75, width: 12.5, height: 12.5))
            ring.lineWidth = 1.5; ring.stroke()
            let hands = NSBezierPath()
            hands.lineWidth = 1.5; hands.lineCapStyle = .round; hands.lineJoinStyle = .round
            hands.move(to: NSPoint(x: 8, y: 11.5)); hands.line(to: NSPoint(x: 8, y: 8))
            hands.line(to: NSPoint(x: 5.25, y: 8)); hands.stroke()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Azure timetracker"
        return image
    }

    @objc private func toggle() {
        if model.showAppearanceOnboarding { model.revealWindow?(); return }
        if popover.isShown { popover.performClose(nil) } else { show() }
    }

    private func show() {
        guard !model.showAppearanceOnboarding else { model.revealWindow?(); return }
        guard !popover.isShown, let button = statusItem.button else { return }
        // Give the panel keyboard focus even when a branch changed in another app.
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
    }

    func popoverDidClose(_ notification: Notification) {
        model.cancelMenuTracking()
    }
}

import AppKit
@preconcurrency import ApplicationServices
import AzureTimetrackerCore
import Combine
import os

/// All synchronous Accessibility calls are isolated from the UI and restricted to file metadata.
private actor FigmaReader {
    private var enabledPID: pid_t?
    private let logger = Logger(subsystem: "be.yarne.azure-timetracker", category: "Figma")
    func read(pid: pid_t) -> FigmaObservation {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.12)
        if enabledPID != pid {
            enabledPID = pid
            let result = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            if result != .success { logger.notice("Figma accessibility tree request failed: \(result.rawValue, privacy: .public)") }
        }
        func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
            var result: CFTypeRef?
            return AXUIElementCopyAttributeValue(element, name, &result) == .success ? result : nil
        }
        guard let value = attribute(app, kAXFocusedWindowAttribute as CFString), CFGetTypeID(value) == AXUIElementGetTypeID() else { return .noAddress }
        let window = unsafeDowncast(value, to: AXUIElement.self)
        let title = attribute(window, kAXTitleAttribute as CFString) as? String ?? ""
        var stack = [window], count = 0
        let deadline = ContinuousClock.now.advanced(by: .seconds(1.8))
        while let element = stack.popLast(), count < 200, ContinuousClock.now < deadline, !Task.isCancelled {
            count += 1; AXUIElementSetMessagingTimeout(element, 0.12)
            for name in [kAXURLAttribute, kAXDocumentAttribute] {
                let raw = attribute(element, name as CFString)
                let address = (raw as? URL)?.absoluteString ?? (raw as? String)
                if let address, let document = FigmaDocument.parse(address, title: title) { return .file(document) }
            }
            if let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
                stack.append(contentsOf: children.prefix(200 - count).reversed())
            }
        }
        return .noAddress
    }
}

@MainActor final class FigmaService: ObservableObject {
    @Published private(set) var observation: FigmaObservation = .waiting
    @Published private(set) var lastForeground: FigmaObservation?
    @Published private(set) var lastForegroundAt: Date?
    @Published private(set) var lastFocusedFile: String?
    @Published private(set) var enabled = false
    @Published private(set) var paused = false
    @Published private(set) var hasAccess = AXIsProcessTrusted()
    var observed: ((FigmaObservation, Date) -> Void)?
    private var loop: Task<Void, Never>?
    private var generation = UUID()
    private let reader = FigmaReader()
    var status: String {
        if !enabled { return "Disabled" }
        if paused { return "Paused" }
        switch observation {
        case .missingAccess: return "Accessibility permission needed"
        case .waiting:
            let previous = lastForeground?.document.map { "Seen: " + $0.name } ?? "No file address found"
            return "Waiting for Figma" + (lastForegroundAt.map { " · " + $0.formatted(date: .omitted, time: .shortened) + " · " + previous } ?? "")
        case .noAddress: return "Figma is active · no file address found"
        case .file(let file): return "File: " + file.name
        }
    }
    func requestAccess() {
        hasAccess = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    }
    func refreshPermission() { hasAccess = AXIsProcessTrusted() }
    func configure(enabled: Bool, paused: Bool, preview: Bool) {
        guard self.enabled != enabled || self.paused != paused || loop == nil else { return }
        self.enabled = enabled; self.paused = paused
        loop?.cancel(); loop = nil; generation = UUID()
        guard enabled, !paused, !preview else { observed?(.waiting, Date()); return }
        let token = generation
        loop = Task { [weak self] in
            while !Task.isCancelled {
                let began = ContinuousClock.now
                guard let self, generation == token else { return }
                refreshPermission()
                let result: FigmaObservation
                if !hasAccess { result = .missingAccess }
                else if let front = NSWorkspace.shared.frontmostApplication, front.bundleIdentifier == "com.figma.Desktop" {
                    let pid = front.processIdentifier
                    let read = await reader.read(pid: pid)
                    // Discard a stale result if focus changed while the AX tree was being read.
                    result = NSWorkspace.shared.frontmostApplication?.processIdentifier == pid ? read : .waiting
                } else { result = .waiting }
                guard generation == token, !Task.isCancelled else { return }
                observation = result
                if result.foreground { lastForeground = result; lastForegroundAt = Date() }
                if let document = result.document { lastFocusedFile = document.key }
                observed?(result, Date())
                try? await Task.sleep(until: began.advanced(by: .seconds(2)), clock: .continuous)
            }
        }
    }
    func clearFocus() { lastFocusedFile = nil; lastForeground = nil; lastForegroundAt = nil }
    func open(_ key: String, desktop: Bool) throws {
        guard FigmaDocument.validKey(key) else { throw AppError.message("This Figma file key is invalid.") }
        if desktop {
            guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.figma.Desktop"), let url = URL(string: "figma://file/" + key) else { throw AppError.message("Install Figma Desktop to open this file in Figma.") }
            NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
        } else if let url = URL(string: "https://www.figma.com/file/" + key) { NSWorkspace.shared.open(url) }
    }
}

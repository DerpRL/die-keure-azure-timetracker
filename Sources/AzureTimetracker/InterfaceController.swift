import AppKit
import Combine
import AzureTimetrackerCore

@MainActor final class InterfaceController: ObservableObject {
    @Published private(set) var preferences = InterfacePreferences()
    @Published private(set) var systemDark = false
    @Published private(set) var systemIncreasedContrast = false
    private var appearanceObservation: NSKeyValueObservation?
    private var contrastObservation: AnyCancellable?
    var isDark: Bool { preferences.isDark(systemDark: systemDark) }
    var increasedContrast: Bool { preferences.increasedContrast(systemIncreased: systemIncreasedContrast) }
    var appearance: NSAppearance {
        let name: NSAppearance.Name = increasedContrast
            ? (isDark ? .accessibilityHighContrastDarkAqua : .accessibilityHighContrastAqua)
            : (isDark ? .darkAqua : .aqua)
        return NSAppearance(named: name)!
    }
    func apply(_ preferences: InterfacePreferences) {
        if self.preferences != preferences { self.preferences = preferences }
    }
    func start() {
        guard appearanceObservation == nil else { return }
        refreshSystem()
        // The application itself keeps its system appearance; only its windows/popovers are overridden.
        appearanceObservation = NSApplication.shared.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in self?.refreshSystem() }
        }
        contrastObservation = NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.refreshSystem() }
    }
    private func refreshSystem() {
        let dark = NSApplication.shared.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let contrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        if systemDark != dark { systemDark = dark }
        if systemIncreasedContrast != contrast { systemIncreasedContrast = contrast }
    }
}

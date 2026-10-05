import Foundation

public enum InterfaceTheme: String, Codable, CaseIterable, Identifiable, Sendable {
    case system, light, dark
    public var id: Self { self }
    public var label: String { switch self { case .system: "System"; case .light: "Light"; case .dark: "Dark" } }
}
public enum InterfaceContrast: String, Codable, CaseIterable, Identifiable, Sendable {
    case system, standard, increased
    public var id: Self { self }
    public var label: String { switch self { case .system: "System"; case .standard: "Standard"; case .increased: "Increased" } }
}
public enum InterfaceScale: Int, Codable, CaseIterable, Identifiable, Sendable {
    case compact = 90, standard = 100, large = 110, larger = 125, largest = 150
    public var id: Self { self }
    public var factor: Double { Double(rawValue) / 100 }
    public var label: String { "\(rawValue)%" }
}
public struct InterfacePreferences: Codable, Equatable, Sendable {
    public var theme: InterfaceTheme = .system
    public var scale: InterfaceScale = .standard
    public var contrast: InterfaceContrast = .system
    public init() {}
    private enum CodingKeys: String, CodingKey { case theme, scale, contrast }
    // Unsupported future values must not prevent loading account and tracking settings.
    public init(from decoder: Decoder) throws {
        let values = try? decoder.container(keyedBy: CodingKeys.self)
        theme = (try? values?.decode(InterfaceTheme.self, forKey: .theme)) ?? .system
        scale = (try? values?.decode(InterfaceScale.self, forKey: .scale)) ?? .standard
        contrast = (try? values?.decode(InterfaceContrast.self, forKey: .contrast)) ?? .system
    }
    public func isDark(systemDark: Bool) -> Bool { theme == .dark || (theme == .system && systemDark) }
    public func increasedContrast(systemIncreased: Bool) -> Bool { contrast == .increased || (contrast == .system && systemIncreased) }
    public static func needsOnboarding(hasSavedSettings: Bool, completed: Bool?) -> Bool {
        // Older saved configurations predate onboarding; an explicitly unfinished setup resumes.
        completed.map { !$0 } ?? !hasSavedSettings
    }
}

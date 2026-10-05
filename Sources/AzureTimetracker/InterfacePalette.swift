import SwiftUI

/// Explicit app contrast is independent of macOS's system-only SwiftUI contrast environment.
/// Standard mode reuses the original dynamic colors unchanged.
struct InterfacePalette {
    var dark = false
    var increased = false
    var accent: Color { increased ? (dark ? Color(red: 0.56, green: 1, blue: 0.92) : Color(red: 0.01, green: 0.28, blue: 0.26)) : Palette.accent }
    var secondary: Color { increased ? (dark ? Color(red: 0.95, green: 0.97, blue: 1) : Color(red: 0.12, green: 0.14, blue: 0.16)) : Palette.secondary }
    var warning: Color { increased ? (dark ? Color(red: 1, green: 0.84, blue: 0.50) : Color(red: 0.46, green: 0.21, blue: 0)) : Palette.warning }
    var line: Color { increased ? (dark ? Color.white : Color.black).opacity(0.65) : Palette.line }
    var action: Color { Palette.action }
    var background: Color { Palette.background }
    var card: Color { Palette.card }
}
private struct InterfacePaletteKey: EnvironmentKey { static let defaultValue = InterfacePalette() }
extension EnvironmentValues {
    var interfacePalette: InterfacePalette {
        get { self[InterfacePaletteKey.self] }
        set { self[InterfacePaletteKey.self] = newValue }
    }
}

import SwiftUI
import AzureTimetrackerCore

struct AppearancePreferencesView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var interface: InterfaceController
    var onboarding = false
    private func preference<Value>(_ keyPath: WritableKeyPath<InterfacePreferences, Value>) -> Binding<Value> {
        Binding(get: { interface.preferences[keyPath: keyPath] }, set: { value in
            var preferences = interface.preferences; preferences[keyPath: keyPath] = value
            model.setInterfacePreferences(preferences)
        })
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if !onboarding { AppSectionHeading("Appearance & readability", subtitle: "Changes apply immediately and are saved on this Mac.") }
            VStack(alignment: .leading, spacing: 8) {
                Text("Appearance").font(.headline)
                Picker("Appearance", selection: preference(\.theme)) {
                    ForEach(InterfaceTheme.allCases) { Text($0.label).tag($0) }
                }.pickerStyle(.segmented).labelsHidden().accessibilityLabel("Appearance")
                Text("System follows your Mac’s Light, Dark or automatic appearance.").font(.callout).foregroundStyle(palette.secondary)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text("UI scale").font(.headline)
                Picker("UI scale", selection: preference(\.scale)) {
                    ForEach(InterfaceScale.allCases) { Text($0.label).tag($0) }
                }.pickerStyle(.segmented).labelsHidden().accessibilityLabel("UI scale")
                Text("Resize text, buttons and charts together. Enlarged pages and dialogs can scroll to keep every control within reach. The menu-bar clock stays its normal size.")
                    .font(.callout).foregroundStyle(palette.secondary)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text("UI contrast").font(.headline)
                Picker("UI contrast", selection: preference(\.contrast)) {
                    ForEach(InterfaceContrast.allCases) { Text($0.label).tag($0) }
                }.pickerStyle(.segmented).labelsHidden().accessibilityLabel("UI contrast")
                Text("Increased strengthens text, accents and section borders. System follows Increase contrast in macOS Accessibility settings.")
                    .font(.callout).foregroundStyle(palette.secondary)
            }
            HStack(spacing: 12) {
                Label("Example: tracking is active", systemImage: "clock").font(.callout.weight(.medium))
                Spacer()
                Text("Secondary text").font(.callout).foregroundStyle(palette.secondary)
            }.padding(14).frame(maxWidth: .infinity).background(palette.background, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.line, lineWidth: 1))
            Button("Reset appearance defaults") { model.setInterfacePreferences(InterfacePreferences()) }
                .disabled(interface.preferences == InterfacePreferences())
        }.buttonStyle(.bordered).controlSize(.large)
    }
}

struct AppearanceOnboardingView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var interface: InterfaceController
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Label("Azure timetracker", systemImage: "clock").font(.headline).foregroundStyle(palette.accent)
                SectionTitle(title: "Make yourself comfortable", subtitle: "Choose Light, Dark or System before connecting your accounts. You can change these choices later in Settings → Appearance.")
                Card { AppearancePreferencesView(model: model, interface: interface, onboarding: true) }
                Card { FigmaSettingsView(model: model, figma: model.figma, onboarding: true) }
                if let error = model.error { Text(error).foregroundStyle(palette.warning).textSelection(.enabled) }
                HStack {
                    Text("Next: connect Azure DevOps and 7pace.").font(.callout).foregroundStyle(palette.secondary)
                    Spacer()
                    Button("Continue to setup") { model.finishAppearanceOnboarding() }
                        .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white).controlSize(.large)
                        .keyboardShortcut(.defaultAction)
                }
                Text("Azure timetracker lives in the menu bar. After setup, use the clock at the top of your screen to open it.")
                    .font(.callout).foregroundStyle(palette.secondary)
            }.padding(32).frame(maxWidth: 800).frame(maxWidth: .infinity)
        }.background(palette.background)
    }
}

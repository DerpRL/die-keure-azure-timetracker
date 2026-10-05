import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct InterfacePreferencesTests {
    @Test func oldConfigurationsKeepAccountsAndUseSystemDefaults() throws {
        var original = Configuration(); original.organization = "example"; original.project = "Project"
        original.repositories = [Repository(path: "/example/repository")]
        original.checksForUpdates = false
        let restored = try JSONDecoder().decode(Configuration.self, from: JSONEncoder().encode(original))
        #expect(restored.interface == InterfacePreferences())
        #expect(restored.organization == original.organization && restored.repositories == original.repositories)
        #expect(!restored.checksForUpdates)
        #expect(!InterfacePreferences.needsOnboarding(hasSavedSettings: true, completed: restored.interfaceSetupCompleted))
    }
    @Test func firstRunAndInterruptedOnboardingPromptButCompletedSetupDoesNot() {
        #expect(InterfacePreferences.needsOnboarding(hasSavedSettings: false, completed: nil))
        #expect(InterfacePreferences.needsOnboarding(hasSavedSettings: true, completed: false))
        #expect(!InterfacePreferences.needsOnboarding(hasSavedSettings: true, completed: true))
    }
    @Test(arguments: InterfaceTheme.allCases) func themeOverridesOnlyWhenExplicit(_ theme: InterfaceTheme) {
        var preferences = InterfacePreferences(); preferences.theme = theme
        for dark in [false, true] {
            #expect(preferences.isDark(systemDark: dark) == (theme == .system ? dark : theme == .dark))
        }
    }
    @Test(arguments: InterfaceContrast.allCases) func contrastFollowsSystemOrExplicitChoice(_ contrast: InterfaceContrast) {
        var preferences = InterfacePreferences(); preferences.contrast = contrast
        for increased in [false, true] {
            #expect(preferences.increasedContrast(systemIncreased: increased) == (contrast == .system ? increased : contrast == .increased))
        }
    }
    @Test(arguments: InterfaceScale.allCases) func preferencesAndCompletionSurviveRestart(_ scale: InterfaceScale) throws {
        var original = Configuration(), preferences = InterfacePreferences()
        preferences.theme = .dark; preferences.scale = scale; preferences.contrast = .increased
        original.interface = preferences; original.interfaceSetupCompleted = true
        let restored = try JSONDecoder().decode(Configuration.self, from: JSONEncoder().encode(original))
        #expect(restored.interface == preferences)
        #expect(restored.interfaceSetupCompleted == true)
        #expect(restored.interface.scale.factor >= 0.9 && restored.interface.scale.factor <= 1.5)
    }
    @Test(arguments: [#"{"theme":"future","scale":800,"contrast":"unknown"}"#, #"{"theme":5,"scale":"large","contrast":null}"#, #"[]"#, #"{}"#])
    func invalidOrFuturePreferencesDoNotBreakConfiguration(_ json: String) throws {
        let defaults = try JSONDecoder().decode(InterfacePreferences.self, from: Data(json.utf8))
        #expect(defaults == InterfacePreferences())
    }
    @Test func partialPreferencesPreserveValidChoices() throws {
        let settings = try JSONDecoder().decode(InterfacePreferences.self, from: Data(#"{"theme":"light","scale":-1,"contrast":"increased"}"#.utf8))
        #expect(settings.theme == .light && settings.scale == .standard && settings.contrast == .increased)
    }
}

import AppKit
import Carbon
import Combine

/// A registered system hot key needs no keyboard monitoring or Accessibility grant.
@MainActor final class QuickSwitchShortcut {
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var subscription: AnyCancellable?
    private weak var model: AppModel?

    init(model: AppModel) {
        self.model = model
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let result = InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else { return OSStatus(eventNotHandledErr) }
            MainActor.assumeIsolated {
                Unmanaged<QuickSwitchShortcut>.fromOpaque(context).takeUnretainedValue().model?.quickSwitch()
            }
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard result == noErr else { model.shortcutIssue = "Could not install the quick-switch shortcut. Use Switch ticket in the menu bar."; return }
        subscription = model.$configuration.map { $0.quickSwitchEnabled ?? true }.removeDuplicates()
            .sink { [weak self] enabled in self?.register(enabled: enabled) }
    }

    private func register(enabled: Bool) {
        if let hotKey { UnregisterEventHotKey(hotKey); self.hotKey = nil }
        model?.shortcutIssue = nil
        guard enabled else { return }
        let identifier = EventHotKeyID(signature: 0x415A5454, id: 1)
        let result = RegisterEventHotKey(UInt32(kVK_ANSI_T), UInt32(controlKey | optionKey), identifier,
                                        GetApplicationEventTarget(), 0, &hotKey)
        if result != noErr { model?.shortcutIssue = "⌃⌥T is unavailable or already used by another app. Use Switch ticket in the menu bar." }
    }

    func stop() {
        subscription = nil
        if let hotKey { UnregisterEventHotKey(hotKey); self.hotKey = nil }
        if let handler { RemoveEventHandler(handler); self.handler = nil }
    }
}

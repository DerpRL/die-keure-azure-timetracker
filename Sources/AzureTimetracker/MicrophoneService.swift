import AppKit
import CoreAudio
import Combine
import AzureTimetrackerCore

/// Reads HAL metadata only. Does not create an audio stream, tap, recording, or permission prompt.
enum MicrophoneReader {
    struct Process: Sendable { let pid: pid_t; let bundleID: String }
    static func read() throws -> [Process] {
        guard #available(macOS 14.2, *) else { throw AppError.message("Microphone app detection requires macOS 14.2 or later.") }
        let system = AudioObjectID(kAudioObjectSystemObject)
        var address = address(kAudioHardwarePropertyProcessObjectList)
        var size: UInt32 = 0
        try check(AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size))
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        if size > 0 { try objects.withUnsafeMutableBytes { try check(AudioObjectGetPropertyData(system, &address, 0, nil, &size, $0.baseAddress!)) } }
        var result: [Process] = []
        for object in objects.prefix(Int(size) / MemoryLayout<AudioObjectID>.size) {
            var running: UInt32 = 0; var bytes = UInt32(MemoryLayout<UInt32>.size)
            var property = self.address(kAudioProcessPropertyIsRunningInput)
            try check(AudioObjectGetPropertyData(object, &property, 0, nil, &bytes, &running))
            guard running != 0 else { continue }
            var pid: pid_t = 0; bytes = UInt32(MemoryLayout<pid_t>.size)
            property = self.address(kAudioProcessPropertyPID)
            try check(AudioObjectGetPropertyData(object, &property, 0, nil, &bytes, &pid))
            var bundle: Unmanaged<CFString>?; bytes = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
            property = self.address(kAudioProcessPropertyBundleID)
            let status = AudioObjectGetPropertyData(object, &property, 0, nil, &bytes, &bundle)
            let bundleID = status == noErr ? (bundle?.takeRetainedValue() as String? ?? "") : ""
            result.append(Process(pid: pid, bundleID: bundleID))
        }
        return result
    }
    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }
    private static func check(_ status: OSStatus) throws {
        guard status == noErr else { throw AppError.message("macOS microphone status is temporarily unavailable (\(status)). Retrying automatically.") }
    }
    @MainActor static func owner(_ process: Process) -> MicrophoneOwner {
        // Audio services often live in a helper inside the application's bundle.
        // Resolve its containing app without inspecting windows or browser tabs.
        let running = NSRunningApplication(processIdentifier: process.pid)
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        let count = proc_pidpath(process.pid, &buffer, UInt32(buffer.count))
        let path = count > 0 ? String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self) : running?.bundleURL?.path ?? ""
        var components = URL(fileURLWithPath: path).pathComponents
        if let index = components.firstIndex(where: { $0.hasSuffix(".app") }) {
            components = Array(components.prefix(index + 1))
            if let bundle = Bundle(path: NSString.path(withComponents: components)), let id = bundle.bundleIdentifier {
                return MicrophoneOwner(id: id, name: bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ?? URL(fileURLWithPath: bundle.bundlePath).deletingPathExtension().lastPathComponent)
            }
        }
        let id = running?.bundleIdentifier ?? process.bundleID
        if id.lowercased().hasPrefix("com.apple.webkit.") { return MicrophoneOwner(id: id, name: "WebKit (browser or web view)") }
        return MicrophoneOwner(id: id.isEmpty ? "process:\(process.pid)" : id,
            name: running?.localizedName ?? (id.isEmpty ? "Unidentified audio app" : id))
    }
}

@MainActor final class MicrophoneService: ObservableObject {
    @Published private(set) var status = "Microphone meeting suggestions are off"
    @Published private(set) var owners: [MicrophoneOwner] = []
    @Published private(set) var connected = false
    @Published private(set) var checking = false
    @Published private(set) var lastConfirmed: Date?
    var changed: (() -> Void)?
    private(set) var engine = MicrophoneMeetingEngine()
    private var preferences = MicrophonePreferences()
    private var task: Task<Void, Never>?
    private var generation = UUID()
    func configure(_ preferences: MicrophonePreferences, restoring: [MicrophoneSession] = []) {
        guard task == nil || self.preferences != preferences else { return }
        task?.cancel(); task = nil; generation = UUID(); engine = MicrophoneMeetingEngine()
        self.preferences = preferences; connected = false; owners = []; lastConfirmed = nil; checking = false
        guard preferences.enabled else { status = "Microphone meeting suggestions are off"; changed?(); return }
        for session in restoring where preferences.apps.contains(session.owner.category) { engine.restore(session) }
        let current = generation
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, generation == current else { return }
                await checkNow()
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
            }
        }
    }
    func checkNow() async {
        guard preferences.enabled, !checking else { return }
        checking = true; let current = generation
        defer { if current == generation { checking = false; changed?() } }
        do {
            let processes = try await Task.detached(priority: .utility) { try MicrophoneReader.read() }.value
            guard current == generation, !Task.isCancelled else { return }
            var seen = Set<String>()
            owners = processes.map(MicrophoneReader.owner).filter { seen.insert($0.id).inserted }.sorted { $0.name < $1.name }
            engine.sample(owners.filter { preferences.apps.contains($0.category) }, at: Date())
            connected = true; lastConfirmed = Date()
            status = owners.isEmpty ? "Watching microphone status · checked every 2 seconds" : "Microphone in use: " + owners.map(\.name).joined(separator: ", ")
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            engine.sample(nil, at: Date()); connected = false; status = error.localizedDescription
        }
    }
    var selectedInputAppIDs: Set<String> { Set(owners.filter { preferences.apps.contains($0.category) }.map(\.id)) }
    var enabled: Bool { preferences.enabled }
    var fresh: Bool { connected && (lastConfirmed.map { Date().timeIntervalSince($0) < 10 } ?? false) }
    func suggestions() -> [MicrophoneSession] { fresh ? engine.suggestions() : [] }
    func isActive(_ session: MicrophoneSession) -> Bool { fresh && engine.isActive(session) }
    func validateCurrent(_ session: MicrophoneSession) throws {
        guard isActive(session) else { throw AppError.message("Microphone use is no longer confirmed. Check meeting detection in Settings or choose tracking manually.") }
    }
}

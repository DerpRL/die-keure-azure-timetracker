import Foundation

public struct UpdateInstallJob: Codable, Sendable {
    public var envelope: SignedAppRelease
    public var archive: URL
    public var destination: URL
    public var currentVersion: String
    public var currentBuild: Int
    public var parentPID: Int32
    public var resultURL: URL
    public init(envelope: SignedAppRelease, archive: URL, destination: URL, currentVersion: String, currentBuild: Int, parentPID: Int32, resultURL: URL) {
        self.envelope = envelope; self.archive = archive; self.destination = destination
        self.currentVersion = currentVersion; self.currentBuild = currentBuild; self.parentPID = parentPID; self.resultURL = resultURL
    }
}
public struct UpdateInstallResult: Codable, Sendable {
    public var success: Bool
    public var version: String
    public var message: String
    public init(success: Bool, version: String, message: String) { self.success = success; self.version = version; self.message = message }
}

public enum UpdateInstallation {
    public static func run(_ executable: String, _ arguments: [String]) throws {
        let task = Process(); task.executableURL = URL(fileURLWithPath: executable); task.arguments = arguments
        // These tools have bounded diagnostic output; drain while they run to avoid a full pipe.
        let pipe = Pipe(); task.standardOutput = pipe; task.standardError = pipe
        try task.run()
        let output = pipe.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit()
        guard task.terminationStatus == 0 else {
            let message = String(data: output.prefix(8192), encoding: .utf8) ?? "Operation failed"
            throw AppError.message("Update preparation failed: " + message)
        }
    }
    public static func verifyBundle(_ url: URL, release: AppRelease) throws {
        guard try UpdateBundle(at: url).matches(release) else { throw AppError.message("The downloaded app version does not match its signed release manifest.") }
        let executable = url.appendingPathComponent("Contents/MacOS/AzureTimetracker")
        let helper = url.appendingPathComponent("Contents/Helpers/AzureTimetrackerUpdater")
        guard FileManager.default.isExecutableFile(atPath: executable.path), FileManager.default.isExecutableFile(atPath: helper.path) else {
            throw AppError.message("The update is missing its application or installer helper.")
        }
        try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", url.path])
    }
    public static func extract(archive: URL, release: AppRelease, directory: URL) throws -> URL {
        let data = try Data(contentsOf: archive, options: .mappedIfSafe)
        try release.verifyArchive(data)
        guard !FileManager.default.fileExists(atPath: directory.path) else { throw AppError.message("The update staging folder already exists.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        do {
            try run("/usr/bin/ditto", ["-x", "-k", archive.path, directory.path])
            let bundle = directory.appendingPathComponent("Azure timetracker.app", isDirectory: true)
            guard let files = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { throw AppError.message("Could not inspect the update.") }
            for case let file as URL in files {
                guard try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw AppError.message("Symbolic links are not supported inside update bundles.") }
            }
            try verifyBundle(bundle, release: release)
            return bundle
        } catch { try? FileManager.default.removeItem(at: directory); throw error }
    }
    /// Copies beside the installed app, then renames on the same filesystem. The original remains recoverable.
    public static func replace(staged: URL, destination: URL, expectedVersion: String, expectedBuild: Int,
                               validate: (URL) throws -> Void) throws -> URL {
        let fm = FileManager.default, target = destination.standardizedFileURL
        guard target.isFileURL, target.pathExtension == "app", target == target.resolvingSymlinksInPath(),
              try UpdateBundle(at: target).version == expectedVersion, try UpdateBundle(at: target).build == expectedBuild else {
            throw AppError.message("The installed application moved or changed. Reopen it and check for updates again.")
        }
        let parent = target.deletingLastPathComponent()
        guard fm.isWritableFile(atPath: parent.path) else { throw AppError.message("This app’s folder is not writable. Install the downloaded release with Finder or macOS Installer, or use an app in your personal Applications folder.") }
        let id = UUID().uuidString
        let incoming = parent.appendingPathComponent(".AzureTimetracker-incoming-" + id + ".app")
        let backup = parent.appendingPathComponent(".AzureTimetracker-previous-" + id + ".app")
        let lock = parent.appendingPathComponent(".azure-timetracker-update-lock")
        do { try fm.createDirectory(at: lock, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
        catch { throw AppError.message("The app folder is protected or another update is running. Use the DMG/PKG installer if macOS does not allow replacement.") }
        defer { try? fm.removeItem(at: lock); try? fm.removeItem(at: incoming) }
        try fm.copyItem(at: staged, to: incoming)
        try validate(incoming)
        let current = try UpdateBundle(at: target)
        guard current.version == expectedVersion, current.build == expectedBuild else { throw AppError.message("Another update changed the app while this update was being prepared.") }
        try fm.moveItem(at: target, to: backup)
        do {
            try fm.moveItem(at: incoming, to: target)
            try validate(target)
        } catch {
            if fm.fileExists(atPath: target.path) { try? fm.moveItem(at: target, to: incoming) }
            do { try fm.moveItem(at: backup, to: target) }
            catch { throw AppError.message("The update could not finish. Your previous app is preserved at " + backup.path + ". Restore it with Finder.") }
            throw error
        }
        return backup
    }
    public static func rollback(destination: URL, backup: URL) throws {
        let failed = destination.deletingLastPathComponent().appendingPathComponent(".AzureTimetracker-failed-" + UUID().uuidString + ".app")
        try FileManager.default.moveItem(at: destination, to: failed)
        do { try FileManager.default.moveItem(at: backup, to: destination) }
        catch { try? FileManager.default.moveItem(at: failed, to: destination); throw error }
        try? FileManager.default.removeItem(at: failed)
    }
}

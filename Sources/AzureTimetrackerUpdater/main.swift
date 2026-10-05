import Foundation
import AppKit
import Darwin
import AzureTimetrackerCore

@main struct UpdaterHelper {
    @MainActor static func main() async {
        guard CommandLine.arguments.count == 2 else { return }
        let jobURL = URL(fileURLWithPath: CommandLine.arguments[1])
        guard let data = try? Data(contentsOf: jobURL), data.count < 256 * 1024,
              let job = try? JSONDecoder().decode(UpdateInstallJob.self, from: data) else { return }
        var message = "", success = false
        do {
            let release = try job.envelope.verified()
            guard try release.supports(ProcessInfo.processInfo.operatingSystemVersion),
                  try release.isNewer(than: job.currentVersion, build: job.currentBuild), job.parentPID > 1,
                  job.parentPID != getpid() else { throw AppError.message("The update no longer applies to this app or macOS version.") }
            // Wait for the specific process; never kill a running app or interrupt a tracking write.
            var attempts = 0
            while kill(job.parentPID, 0) == 0 {
                guard attempts < 300 else { throw AppError.message("The app did not close. Quit it and try the update again.") }
                attempts += 1; try await Task.sleep(for: .milliseconds(200))
            }
            let extraction = jobURL.deletingLastPathComponent().appendingPathComponent("install-" + UUID().uuidString)
            let source = try UpdateInstallation.extract(archive: job.archive, release: release, directory: extraction)
            defer { try? FileManager.default.removeItem(at: extraction) }
            let backup = try UpdateInstallation.replace(staged: source, destination: job.destination,
                expectedVersion: job.currentVersion, expectedBuild: job.currentBuild) { try UpdateInstallation.verifyBundle($0, release: release) }
            do {
                try writeResult(job, success: true, message: "Updated to " + release.version + ".")
                try await launch(job.destination)
                success = true
                // Keep the previous app for manual recovery; do not delete an administrator-owned bundle.
                message = "Updated to " + release.version + ". Previous application: " + backup.path
            } catch {
                try UpdateInstallation.rollback(destination: job.destination, backup: backup)
                throw AppError.message("The new version could not launch. The previous app was restored. " + error.localizedDescription)
            }
        } catch {
            message = error.localizedDescription
            try? writeResult(job, success: false, message: message)
            // Relaunch only if the original app has exited; no duplicate instances after a quit timeout.
            if kill(job.parentPID, 0) != 0 { try? await launch(job.destination) }
        }
        if !success { FileHandle.standardError.write(Data((message + "\n").utf8)) }
    }
    static func writeResult(_ job: UpdateInstallJob, success: Bool, message: String) throws {
        let result = UpdateInstallResult(success: success, version: job.envelope.release.version, message: message)
        try FileManager.default.createDirectory(at: job.resultURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(result).write(to: job.resultURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: job.resultURL.path)
    }
    @MainActor static func launch(_ url: URL) async throws {
        let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = false
        _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
    }
}

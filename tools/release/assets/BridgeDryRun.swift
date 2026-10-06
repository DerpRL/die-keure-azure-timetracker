// Driver for `att-release bridge-dry-run`. It is compiled together with the unmodified 1.14.x
// sources in Sources/AzureTimetrackerCore, so every check below is the client's own code:
// AppRelease.validate, isNewer, supports, verifyArchive (size, SHA-256, UpdateArchive.validate),
// UpdateInstallation.extract (ditto, symlink scan, verifyBundle with codesign --verify --deep
// --strict) and UpdateInstallation.replace, which swaps the installed app in place and keeps the
// previous bundle beside it, as the 1.x helper does.
//
// Skipped on purpose: the manifest signature (it needs the real key; `AzureTimetrackerRelease`
// checks it when signing and in `verify` mode) and launching the new app.
//
// Usage: BridgeDryRun ZIP SIGNED_APP INSTALLED_APP WORK_DIR
import Foundation

@main struct BridgeDryRun {
    static func main() {
        do { try run() } catch {
            FileHandle.standardError.write(Data(("Bridge dry run failed: " + error.localizedDescription + "\n").utf8))
            exit(1)
        }
    }

    static func run() throws {
        let args = CommandLine.arguments
        guard args.count == 5 else { throw AppError.message("Usage: BridgeDryRun ZIP SIGNED_APP INSTALLED_APP WORK_DIR") }
        let zip = URL(fileURLWithPath: args[1]), source = URL(fileURLWithPath: args[2])
        let installed = URL(fileURLWithPath: args[3]), work = URL(fileURLWithPath: args[4])
        let data = try Data(contentsOf: zip)
        let metadata = try UpdateBundle(at: source)
        // The release the Swift signer will describe, minus its signature.
        let release = AppRelease(version: metadata.version, build: metadata.build, minimumMacOS: metadata.minimumMacOS,
            publishedAt: ISO8601DateFormatter().string(from: Date()), notes: "Bridge dry run",
            url: UpdateTrust.assetURL(version: metadata.version).absoluteString, sha256: AppRelease.digest(data), size: data.count)
        try release.validate()
        print("AppRelease.validate: ok (\(release.version) build \(release.build), minimum macOS \(release.minimumMacOS), \(release.size) bytes)")
        let current = try UpdateBundle(at: installed)
        guard try release.isNewer(than: current.version, build: current.build) else {
            throw AppError.message("\(release.version) is not newer than the installed \(current.version) (build \(current.build)).")
        }
        print("isNewer than the installed \(current.version) (build \(current.build)): yes")
        guard try release.supports(ProcessInfo.processInfo.operatingSystemVersion) else {
            throw AppError.message("This Mac runs a macOS older than \(release.minimumMacOS).")
        }
        print("supports this macOS: yes")
        try release.verifyArchive(data)
        print("verifyArchive (size, SHA-256, ZIP layout): ok")
        let extracted = try UpdateInstallation.extract(archive: zip, release: release,
            directory: work.appendingPathComponent("install-" + UUID().uuidString))
        print("extract (ditto, no symbolic links, bundle identity, executable and helper, codesign): ok")
        let backup = try UpdateInstallation.replace(staged: extracted, destination: installed,
            expectedVersion: current.version, expectedBuild: current.build) { try UpdateInstallation.verifyBundle($0, release: release) }
        let after = try UpdateBundle(at: installed)
        print("replace: ok, \(installed.path) is now \(after.version) (build \(after.build))")
        print("previous app kept at \(backup.path)")
    }
}

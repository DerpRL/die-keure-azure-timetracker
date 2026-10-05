import Foundation
import AppKit
import Combine
import AzureTimetrackerCore

private final class UpdateRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
private actor UpdateDownload {
    private let session: URLSession
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 300
        configuration.urlCache = nil; configuration.httpShouldSetCookies = false
        session = URLSession(configuration: configuration, delegate: UpdateRedirectPolicy(), delegateQueue: nil)
    }
    func data(from url: URL, limit: Int, expected: Int? = nil, progress: @Sendable (Int) async -> Void = { _ in }) async throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("AzureTimetracker-Updater", forHTTPHeaderField: "User-Agent")
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, response.url == url else {
            throw AppError.message("The update server could not provide this file. Check your connection and try Check for updates again.")
        }
        guard response.expectedContentLength <= Int64(limit), expected.map({ response.expectedContentLength < 0 || response.expectedContentLength == $0 }) ?? true else {
            throw AppError.message("The update download size does not match its manifest.")
        }
        var result = Data(); if let expected { result.reserveCapacity(expected) }
        for try await byte in bytes {
            try Task.checkCancellation()
            guard result.count < limit else { throw AppError.message("The update response exceeded its size limit.") }
            result.append(byte)
            if result.count % (128 * 1024) == 0 { await progress(result.count) }
        }
        await progress(result.count)
        return result
    }
}

enum AppUpdatePhase: Equatable { case idle, checking, available, downloading, ready, installing, failed }
@MainActor final class AppUpdateModel: ObservableObject {
    @Published private(set) var phase: AppUpdatePhase = .idle
    @Published private(set) var release: AppRelease?
    @Published private(set) var message = "Checks for updates when the app opens and every six hours."
    @Published private(set) var downloaded = 0
    @Published private(set) var checkedAt: Date?
    @Published private(set) var installIssue: String?
    @Published var showDetails = false
    var automaticChecks = true
    let installedVersion: String
    let installedBuild: Int
    private var disabled = false
    private let network = UpdateDownload()
    private var envelope: SignedAppRelease?
    private var archive: URL?
    private var staging: URL?
    private var task: Task<Void, Never>?
    private var loop: Task<Void, Never>?
    private var attempt = UUID()
    private var lastAutomaticCheck = Date.distantPast
    private let resultURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Azure timetracker/update-result.json")
    init() {
        installedVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        installedBuild = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0
    }
    var inProgress: Bool { phase == .checking || phase == .downloading || phase == .installing }
    var canDownload: Bool { release != nil && (phase == .available || phase == .failed) }
    func start(preview: Bool, automatic: Bool) {
        disabled = preview || Bundle.main.bundleIdentifier != UpdateTrust.bundleID
        automaticChecks = automatic
        guard !disabled, loop == nil else { if disabled && release == nil { message = "Updates are disabled in preview and development builds." }; return }
        if let data = try? Data(contentsOf: resultURL), let result = try? JSONDecoder().decode(UpdateInstallResult.self, from: data) {
            message = result.message; if !result.success { installIssue = result.message; showDetails = true }
            try? FileManager.default.removeItem(at: resultURL)
        }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if automaticChecks, Date().timeIntervalSince(lastAutomaticCheck) >= 6 * 3600 { check(manual: false) }
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
    }
    func check(manual: Bool = true) {
        guard !disabled, !inProgress, phase != .ready else { return }
        if !manual, (!automaticChecks || Date().timeIntervalSince(lastAutomaticCheck) < 3600) { return }
        lastAutomaticCheck = Date(); envelope = nil; release = nil; phase = .checking; message = "Checking GitHub for a new version…"
        let token = UUID(); attempt = token
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let data = try await network.data(from: UpdateTrust.feedURL, limit: 256 * 1024)
                let signed = try JSONDecoder().decode(SignedAppRelease.self, from: data)
                let incoming = try signed.verified()
                guard token == attempt else { return }
                checkedAt = Date()
                if try incoming.isNewer(than: installedVersion, build: installedBuild) {
                    guard try incoming.supports(ProcessInfo.processInfo.operatingSystemVersion) else {
                        throw AppError.message("Version \(incoming.version) requires macOS \(incoming.minimumMacOS) or later.")
                    }
                    envelope = signed; release = incoming; phase = .available; message = "Version \(incoming.version) is available."
                } else { envelope = nil; release = nil; phase = .idle; message = "You’re up to date." }
            } catch { if token == attempt { phase = .failed; message = error.localizedDescription } }
        }
    }
    func download() {
        guard !disabled, canDownload, let envelope, let release else { return }
        let token = UUID(); attempt = token; phase = .downloading; downloaded = 0; message = "Downloading and verifying the update…"
        task = Task { [weak self] in
            guard let self else { return }
            var directory: URL?
            do {
                let data = try await network.data(from: URL(string: release.url)!, limit: release.size, expected: release.size) { [weak self] count in
                    await self?.setProgress(count, token: token)
                }
                try release.verifyArchive(data)
                try Task.checkCancellation()
                let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent(UpdateTrust.bundleID + "/Updates", isDirectory: true)
                let folder = cache.appendingPathComponent(UUID().uuidString, isDirectory: true); directory = folder
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                let zip = folder.appendingPathComponent("update.zip")
                try data.write(to: zip, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: zip.path)
                // Verify the app’s metadata and code signature before offering restart; the helper rechecks independently.
                let preparation = Task.detached { try UpdateInstallation.extract(archive: zip, release: release, directory: folder.appendingPathComponent("preview")) }
                _ = try await preparation.value
                guard token == attempt, !Task.isCancelled else { try? FileManager.default.removeItem(at: folder); return }
                staging = folder; archive = zip; self.envelope = envelope
                phase = .ready; message = "Download verified. Install and restart when you’re ready."
            } catch {
                if let directory { try? FileManager.default.removeItem(at: directory) }
                if token == attempt { phase = .failed; message = error.localizedDescription }
            }
        }
    }
    private func setProgress(_ count: Int, token: UUID) { if attempt == token { downloaded = count } }
    func cancelDownload() {
        guard phase == .downloading else { return }
        attempt = UUID(); task?.cancel(); phase = .available; message = "Download canceled. Your app has not changed."
    }
    func installAndRestart() throws {
        guard !disabled, phase == .ready, let archive, let staging, let envelope else { return }
        let release = try envelope.verified()
        try release.verifyArchive(Data(contentsOf: archive, options: .mappedIfSafe))
        let destination = Bundle.main.bundleURL.standardizedFileURL
        let parent = destination.deletingLastPathComponent()
        guard destination.pathExtension == "app", !destination.path.contains("/AppTranslocation/"), !destination.path.hasPrefix("/Volumes/"),
              FileManager.default.isWritableFile(atPath: parent.path) else {
            throw AppError.message("This app is in a protected or temporary location. Install it in Applications (or your personal Applications folder) using the DMG/PKG first.")
        }
        let job = UpdateInstallJob(envelope: envelope, archive: archive, destination: destination, currentVersion: installedVersion,
            currentBuild: installedBuild, parentPID: ProcessInfo.processInfo.processIdentifier, resultURL: resultURL)
        let jobURL = staging.appendingPathComponent("install-job.json")
        try JSONEncoder().encode(job).write(to: jobURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: jobURL.path)
        let helper = destination.appendingPathComponent("Contents/Helpers/AzureTimetrackerUpdater")
        let process = Process(); process.executableURL = helper; process.arguments = [jobURL.path]
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        try process.run()
        phase = .installing; message = "Closing the app to install the verified update…"
        NSApp.terminate(nil)
    }
    func reportInstallFailure(_ error: Error) { installIssue = error.localizedDescription; phase = .ready }
    func dismissInstallIssue() { installIssue = nil }
    #if UI_PREVIEW
    func previewAvailable() {
        release = AppRelease(version: "1.14.0", build: 21, publishedAt: ISO8601DateFormatter().string(from: Date()),
            notes: "A clearer tracking overview.\nImproved reminder reliability.", url: UpdateTrust.assetURL(version: "1.14.0").absoluteString, sha256: String(repeating: "0", count: 64), size: 8000000)
        phase = ProcessInfo.processInfo.arguments.contains("--preview-update-ready") ? .ready : .available
        message = phase == .ready ? "Download verified. Install and restart when you’re ready." : "Version 1.14.0 is available."
    }
    #endif
}

import Foundation
import CryptoKit
import AzureTimetrackerCore

@main struct ReleaseManifestTool {
    static func verifyArchive(_ archive: URL, release: AppRelease) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("azure-release-verification-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        _ = try UpdateInstallation.extract(archive: archive, release: release, directory: directory)
    }
    static func main() throws {
        let args = CommandLine.arguments
        if args.count == 4, args[1] == "verify" {
            let envelope = try JSONDecoder().decode(SignedAppRelease.self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
            let release = try envelope.verified()
            try verifyArchive(URL(fileURLWithPath: args[3]), release: release)
            print("Verified release \(release.version) (build \(release.build)) and archive.")
            return
        }
        guard args.count == 6 else { throw AppError.message("Usage: AzureTimetrackerRelease APP UPDATE_ZIP PRIVATE_KEY RELEASE_NOTES OUTPUT_JSON") }
        let app = URL(fileURLWithPath: args[1]), archive = URL(fileURLWithPath: args[2]), keyURL = URL(fileURLWithPath: args[3])
        let metadata = try UpdateBundle(at: app), data = try Data(contentsOf: archive)
        let key = try Data(contentsOf: keyURL)
        guard try Curve25519.Signing.PrivateKey(rawRepresentation: key).publicKey.rawRepresentation == UpdateTrust.publicKey else {
            throw AppError.message("The private update-signing key does not match this app’s public verification key.")
        }
        let release = AppRelease(version: metadata.version, build: metadata.build, minimumMacOS: metadata.minimumMacOS,
            publishedAt: ISO8601DateFormatter().string(from: Date()), notes: try String(contentsOfFile: args[4], encoding: .utf8),
            url: UpdateTrust.assetURL(version: metadata.version).absoluteString, sha256: AppRelease.digest(data), size: data.count)
        try verifyArchive(archive, release: release); try UpdateInstallation.verifyBundle(app, release: release)
        let envelope = try SignedAppRelease.signed(release, privateKey: key)
        _ = try envelope.verified()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(envelope).write(to: URL(fileURLWithPath: args[5]), options: .atomic)
        print("Signed and verified release \(release.version) (build \(release.build)). No private key was copied or printed.")
    }
}

import Foundation
import CryptoKit

// Run once. The private key is outside Git and is never printed.
let args = CommandLine.arguments
if args.count != 3 { fatalError("Usage: swift scripts/create-update-key.swift PRIVATE_KEY_PATH PUBLIC_SWIFT_PATH") }
let privateURL = URL(fileURLWithPath: args[1]), publicURL = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: privateURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
let key: Curve25519.Signing.PrivateKey
if FileManager.default.fileExists(atPath: privateURL.path) {
    key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(contentsOf: privateURL))
} else {
    key = Curve25519.Signing.PrivateKey()
    try key.rawRepresentation.write(to: privateURL, options: .withoutOverwriting)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: privateURL.path)
}
let publicKey = key.publicKey.rawRepresentation.base64EncodedString()
let source = """
import Foundation

public enum UpdateTrust {
    public static let bundleID = "be.yarne.azure-timetracker"
    public static let repository = "DerpRL/die-keure-azure-timetracker"
    public static let feedURL = URL(string: "https://raw.githubusercontent.com/\\(repository)/main/updates/latest.json")!
    public static let downloadsURL = URL(string: "https://github.com/\\(repository)/tree/main/releases/latest")!
    // Update verification key only. The private signing key and SSH deploy key never belong in this repository.
    public static let publicKey = Data(base64Encoded: "\(publicKey)")!
    public static func assetURL(version: String) -> URL {
        URL(string: "https://raw.githubusercontent.com/\\(repository)/main/releases/updates/\\(version)/Azure-timetracker-\\(version)-universal-update.zip")!
    }
}

"""
if FileManager.default.fileExists(atPath: publicURL.path), try String(contentsOf: publicURL, encoding: .utf8) != source {
    fatalError("The public trust key already differs. Do not rotate it without an update migration plan.")
}
try source.write(to: publicURL, atomically: true, encoding: .utf8)
print("Update verification key configured. Private signing material remains outside the repository; keep an independent secure backup.")

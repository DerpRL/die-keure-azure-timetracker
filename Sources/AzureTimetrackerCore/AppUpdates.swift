import Foundation
import CryptoKit

public struct AppVersion: Comparable, Equatable, Sendable {
    public let components: [Int]
    public init(_ string: String) throws {
        let parts = string.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) && ($0 == "0" || !$0.hasPrefix("0")) }),
              parts.allSatisfy({ Int($0).map { $0 >= 0 && $0 <= Int32.max } == true }) else { throw AppError.message("The update has an invalid version number.") }
        components = parts.map { Int($0)! }
    }
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.components.lexicographicallyPrecedes(rhs.components) }
}

public struct AppRelease: Codable, Equatable, Sendable {
    public var version: String
    public var build: Int
    public var minimumMacOS: String
    public var publishedAt: String
    public var notes: String
    public var url: String
    public var sha256: String
    public var size: Int
    public var bundleID: String
    public init(version: String, build: Int, minimumMacOS: String = "14.0.0", publishedAt: String, notes: String, url: String, sha256: String, size: Int, bundleID: String = "be.yarne.azure-timetracker") {
        self.version = version; self.build = build; self.minimumMacOS = minimumMacOS; self.publishedAt = publishedAt
        self.notes = notes; self.url = url; self.sha256 = sha256; self.size = size; self.bundleID = bundleID
    }
    public func signingData() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
    public func validate() throws {
        _ = try AppVersion(version); _ = try AppVersion(minimumMacOS)
        let expected = UpdateTrust.assetURL(version: version)
        guard build > 0, build <= Int32.max, bundleID == UpdateTrust.bundleID, url == expected.absoluteString,
              size > 0, size <= 200 * 1024 * 1024, sha256.count == 64, sha256.allSatisfy({ "0123456789abcdef".contains($0) }),
              ISO8601DateFormatter().date(from: publishedAt) != nil, notes.utf8.count <= 64 * 1024 else {
            throw AppError.message("The update manifest contains invalid release details.")
        }
    }
    public func isNewer(than version: String, build: Int) throws -> Bool {
        let incoming = try AppVersion(self.version), current = try AppVersion(version)
        return incoming > current || (incoming == current && self.build > build)
    }
    public func supports(_ os: OperatingSystemVersion) throws -> Bool {
        try AppVersion(minimumMacOS) <= AppVersion("\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)")
    }
    public func verifyArchive(_ data: Data) throws {
        guard data.count == size, Self.digest(data) == sha256 else { throw AppError.message("The update download failed its checksum check. The installed app has not changed.") }
        try UpdateArchive.validate(data)
    }
    public static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}

public struct SignedAppRelease: Codable, Equatable, Sendable {
    public var schemaVersion = 1
    public var release: AppRelease
    public var signature: String
    public init(release: AppRelease, signature: String) { self.release = release; self.signature = signature }
    public static func signed(_ release: AppRelease, privateKey: Data) throws -> Self {
        try release.validate()
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: privateKey)
        return Self(release: release, signature: try key.signature(for: release.signingData()).base64EncodedString())
    }
    public func verified(publicKey: Data = UpdateTrust.publicKey) throws -> AppRelease {
        guard schemaVersion == 1, let signature = Data(base64Encoded: signature), signature.count == 64,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              key.isValidSignature(signature, for: try release.signingData()) else {
            throw AppError.message("This update is not signed by the trusted release key. The installed app has not changed.")
        }
        try release.validate(); return release
    }
}

public struct UpdateBundle: Equatable, Sendable {
    public let version: String
    public let build: Int
    public let minimumMacOS: String
    public init(at url: URL) throws {
        let info = url.appendingPathComponent("Contents/Info.plist")
        let object = try PropertyListSerialization.propertyList(from: Data(contentsOf: info), format: nil)
        guard let dictionary = object as? [String: Any], dictionary["CFBundleIdentifier"] as? String == UpdateTrust.bundleID,
              dictionary["CFBundleExecutable"] as? String == "AzureTimetracker",
              let minimum = dictionary["LSMinimumSystemVersion"] as? String,
              let version = dictionary["CFBundleShortVersionString"] as? String, let text = dictionary["CFBundleVersion"] as? String,
              let build = Int(text), build > 0 else { throw AppError.message("The update is not a valid Azure timetracker application.") }
        minimumMacOS = minimum.split(separator: ".").count == 2 ? minimum + ".0" : minimum
        _ = try AppVersion(minimumMacOS)
        _ = try AppVersion(version); self.version = version; self.build = build
    }
    public func matches(_ release: AppRelease) -> Bool { version == release.version && build == release.build && minimumMacOS == release.minimumMacOS }
}

/// Paths inside an authenticated archive are still validated before invoking an extractor.
public enum UpdateArchive {
    public static func validate(_ data: Data) throws {
        func failure() -> AppError { .message("The update archive has an unsupported or unsafe layout.") }
        func uint(_ offset: Int, _ count: Int) throws -> Int {
            guard offset >= 0, count <= 4, offset <= data.count - count else { throw failure() }
            return (0..<count).reduce(0) { $0 | (Int(data[offset + $1]) << ($1 * 8)) }
        }
        guard data.count >= 22 else { throw failure() }
        var footer: Int?
        for offset in stride(from: data.count - 22, through: max(0, data.count - 65557), by: -1) {
            if try uint(offset, 4) == 0x06054b50, offset + 22 + (try uint(offset + 20, 2)) == data.count { footer = offset; break }
        }
        guard let footer, try uint(footer + 4, 2) == 0, try uint(footer + 6, 2) == 0 else { throw failure() }
        let count = try uint(footer + 10, 2), directorySize = try uint(footer + 12, 4), directory = try uint(footer + 16, 4)
        guard count > 0, count <= 4096, try uint(footer + 8, 2) == count,
              directory + directorySize == footer else { throw failure() }
        var cursor = directory, total = 0, paths = Set<String>()
        for _ in 0..<count {
            guard try uint(cursor, 4) == 0x02014b50, try uint(cursor + 8, 2) & 1 == 0 else { throw failure() }
            let method = try uint(cursor + 10, 2), expanded = try uint(cursor + 24, 4)
            let nameLength = try uint(cursor + 28, 2), extra = try uint(cursor + 30, 2), comment = try uint(cursor + 32, 2)
            let mode = (try uint(cursor + 38, 4) >> 16) & 0xf000, local = try uint(cursor + 42, 4)
            let end = cursor + 46 + nameLength
            guard (method == 0 || method == 8), mode == 0 || mode == 0x8000 || mode == 0x4000,
                  end <= footer, end + extra + comment <= footer, nameLength > 0,
                  let name = String(data: data[(cursor + 46)..<end], encoding: .utf8), !name.contains("\\"), !name.contains("//"),
                  !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
                  name.hasPrefix("Azure timetracker.app/"), !name.split(separator: "/", omittingEmptySubsequences: false).contains(".."),
                  !name.split(separator: "/").contains("."), paths.insert(name).inserted else { throw failure() }
            total += expanded
            guard expanded < 512 * 1024 * 1024, total < 1024 * 1024 * 1024,
                  local < directory, try uint(local, 4) == 0x04034b50,
                  try uint(local + 26, 2) == nameLength, local + 30 + nameLength <= directory,
                  data[(local + 30)..<(local + 30 + nameLength)] == data[(cursor + 46)..<end] else { throw failure() }
            cursor = end + extra + comment
        }
        guard cursor == footer, paths.contains("Azure timetracker.app/Contents/Info.plist"),
              paths.contains("Azure timetracker.app/Contents/MacOS/AzureTimetracker"),
              paths.contains("Azure timetracker.app/Contents/Helpers/AzureTimetrackerUpdater") else { throw failure() }
    }
}

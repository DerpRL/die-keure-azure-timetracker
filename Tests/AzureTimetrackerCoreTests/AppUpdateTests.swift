import Foundation
import CryptoKit
import Testing
@testable import AzureTimetrackerCore

@Suite struct AppUpdateTests {
    func release() -> AppRelease {
        AppRelease(version: "1.13.0", build: 20, publishedAt: "2026-10-05T10:00:00Z", notes: "Update tests", url: UpdateTrust.assetURL(version: "1.13.0").absoluteString, sha256: String(repeating: "a", count: 64), size: 100)
    }
    @Test func comparesVersionsNumericallyAndBuildsOnlyWithinSameVersion() throws {
        #expect(try AppVersion("1.10.0") > AppVersion("1.9.9"))
        #expect(try release().isNewer(than: "1.12.0", build: 200))
        #expect(try release().isNewer(than: "1.13.0", build: 19))
        #expect(try !release().isNewer(than: "1.13.0", build: 20))
        #expect(try !release().isNewer(than: "1.14.0", build: 1))
        #expect(try release().supports(.init(majorVersion: 14, minorVersion: 0, patchVersion: 0)))
        #expect(try !release().supports(.init(majorVersion: 13, minorVersion: 9, patchVersion: 9)))
    }
    @Test(arguments: ["1.2", "1.2.3.4", "01.2.3", "1.-2.0", "1.2.beta", "1.2.3 ", "1.2.2147483648", "١.2.3"])
    func rejectsInvalidVersions(_ value: String) { #expect(throws: (any Error).self) { try AppVersion(value) } }
    @Test func acceptsValidSignatureAcrossJSONFormattingAndRejectsTampering() throws {
        let key = Curve25519.Signing.PrivateKey(), other = Curve25519.Signing.PrivateKey()
        let signed = try SignedAppRelease.signed(release(), privateKey: key.rawRepresentation)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let restored = try JSONDecoder().decode(SignedAppRelease.self, from: encoder.encode(signed))
        #expect(try restored.verified(publicKey: key.publicKey.rawRepresentation) == release())
        #expect(throws: (any Error).self) { try restored.verified(publicKey: other.publicKey.rawRepresentation) }
        var tampered = restored; tampered.release.notes = "Replaced notes"
        #expect(throws: (any Error).self) { try tampered.verified(publicKey: key.publicKey.rawRepresentation) }
        tampered = restored; tampered.schemaVersion = 2
        #expect(throws: (any Error).self) { try tampered.verified(publicKey: key.publicKey.rawRepresentation) }
    }
    @Test(arguments: ["url", "bundle", "size", "hash", "date", "build", "notes"])
    func rejectsInvalidReleaseEvenWhenSigned(_ field: String) throws {
        var invalid = release()
        switch field {
        case "url": invalid.url = "https://example.com/update.zip"
        case "bundle": invalid.bundleID = "other.app"
        case "size": invalid.size = 201 * 1024 * 1024
        case "hash": invalid.sha256 = String(repeating: "A", count: 64)
        case "date": invalid.publishedAt = "not a date"
        case "build": invalid.build = 0
        default: invalid.notes = String(repeating: "a", count: 65537)
        }
        let key = Curve25519.Signing.PrivateKey()
        let signed = SignedAppRelease(release: invalid, signature: try key.signature(for: invalid.signingData()).base64EncodedString())
        #expect(throws: (any Error).self) { try signed.verified(publicKey: key.publicKey.rawRepresentation) }
    }
    @Test func oldSettingsDefaultToAutomaticChecksAndOptOutPersists() throws {
        var original = Configuration(); let encoder = JSONEncoder()
        var object = try #require(JSONSerialization.jsonObject(with: encoder.encode(original)) as? [String: Any])
        object.removeValue(forKey: "automaticUpdateChecks")
        #expect(try JSONDecoder().decode(Configuration.self, from: JSONSerialization.data(withJSONObject: object)).checksForUpdates)
        original.checksForUpdates = false
        #expect(try !JSONDecoder().decode(Configuration.self, from: encoder.encode(original)).checksForUpdates)
    }
    // Minimal stored ZIP fixtures test the parser independently of the release script and extractor.
    struct ZipEntry { var name: String; var mode = 0x81ed; var localName: String?; var flags = 0; var expanded = 0 }
    func archive(_ extra: [ZipEntry] = []) -> Data {
        let entries = ["Contents/Info.plist", "Contents/MacOS/AzureTimetracker", "Contents/Helpers/AzureTimetrackerUpdater"].map { ZipEntry(name: "Azure timetracker.app/" + $0) } + extra
        func put(_ value: Int, _ count: Int, into data: inout Data) { for shift in 0..<count { data.append(UInt8((value >> (shift * 8)) & 255)) } }
        var data = Data(), central = Data()
        for entry in entries {
            let offset = data.count, name = Data(entry.name.utf8), local = Data((entry.localName ?? entry.name).utf8)
            put(0x04034b50, 4, into: &data); put(20, 2, into: &data); put(entry.flags, 2, into: &data)
            data.append(Data(repeating: 0, count: 14)); put(entry.expanded, 4, into: &data); put(local.count, 2, into: &data); put(0, 2, into: &data); data.append(local)
            put(0x02014b50, 4, into: &central); put(0x0314, 2, into: &central); put(20, 2, into: &central); put(entry.flags, 2, into: &central)
            central.append(Data(repeating: 0, count: 14)); put(entry.expanded, 4, into: &central); put(name.count, 2, into: &central)
            central.append(Data(repeating: 0, count: 8)); put(entry.mode << 16, 4, into: &central); put(offset, 4, into: &central); central.append(name)
        }
        let offset = data.count; data.append(central); put(0x06054b50, 4, into: &data); put(0, 4, into: &data)
        put(entries.count, 2, into: &data); put(entries.count, 2, into: &data); put(central.count, 4, into: &data); put(offset, 4, into: &data); put(0, 2, into: &data)
        return data
    }
    @Test func authenticatesArchiveBytesAndAcceptsExpectedLayout() throws {
        let data = archive(); try UpdateArchive.validate(data)
        var manifest = release(); manifest.size = data.count; manifest.sha256 = AppRelease.digest(data)
        try manifest.verifyArchive(data)
        var changed = data; changed[0] ^= 1
        #expect(throws: (any Error).self) { try manifest.verifyArchive(changed) }
        #expect(throws: (any Error).self) { try manifest.verifyArchive(data + Data([0])) }
    }
    @Test(arguments: ["../outside", "Contents/../outside", "Contents/./alias", "Contents//alias", "Contents/Info.plist", "Contents\\alias", "Contents/\nmalformed"])
    func rejectsUnsafeAndDuplicateZIPPaths(_ path: String) {
        #expect(throws: (any Error).self) { try UpdateArchive.validate(archive([ZipEntry(name: "Azure timetracker.app/" + path)])) }
    }
    @Test func rejectsSymlinksEncryptionLocalMismatchAndExpansionBombs() {
        for entry in [ZipEntry(name: "Azure timetracker.app/link", mode: 0xa1ff), ZipEntry(name: "Azure timetracker.app/encrypted", flags: 1), ZipEntry(name: "Azure timetracker.app/name", localName: "Azure timetracker.app/else"), ZipEntry(name: "Azure timetracker.app/huge", expanded: 512 * 1024 * 1024), ZipEntry(name: "Other.app/Contents/Info.plist")] {
            #expect(throws: (any Error).self) { try UpdateArchive.validate(archive([entry])) }
        }
        #expect(throws: (any Error).self) { try UpdateArchive.validate(Data(archive().dropLast())) }
    }
    func temporary(_ action: (URL) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try action(root)
    }
    func bundle(_ path: URL, version: String, build: Int) throws {
        try FileManager.default.createDirectory(at: path.appendingPathComponent("Contents"), withIntermediateDirectories: true)
        let plist = ["LSMinimumSystemVersion": "14.0", "CFBundleIdentifier": UpdateTrust.bundleID, "CFBundleExecutable": "AzureTimetracker", "CFBundleShortVersionString": version, "CFBundleVersion": String(build)]
        try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0).write(to: path.appendingPathComponent("Contents/Info.plist"))
    }
    @Test func replacementPreservesPreviousBundleAndRollbackRestoresIt() throws {
        try temporary { root in
            let current = root.appendingPathComponent("Azure timetracker.app"), staged = root.appendingPathComponent("staged.app")
            try bundle(current, version: "1.12.0", build: 19); try bundle(staged, version: "1.13.0", build: 20)
            let backup = try UpdateInstallation.replace(staged: staged, destination: current, expectedVersion: "1.12.0", expectedBuild: 19) { path in let info = try UpdateBundle(at: path); #expect(info.version == "1.13.0") }
            #expect(try UpdateBundle(at: current).version == "1.13.0"); #expect(try UpdateBundle(at: backup).version == "1.12.0")
            try UpdateInstallation.rollback(destination: current, backup: backup)
            #expect(try UpdateBundle(at: current).version == "1.12.0")
        }
    }
    @Test(arguments: [false, true]) func validationFailureLeavesOriginalIntact(afterSwap: Bool) throws {
        try temporary { root in
            let current = root.appendingPathComponent("Azure timetracker.app"), staged = root.appendingPathComponent("staged.app")
            try bundle(current, version: "1.12.0", build: 19); try bundle(staged, version: "1.13.0", build: 20)
            #expect(throws: (any Error).self) {
                try UpdateInstallation.replace(staged: staged, destination: current, expectedVersion: "1.12.0", expectedBuild: 19) { path in
                    if !afterSwap || path.standardizedFileURL.path == current.standardizedFileURL.path { throw AppError.message("Simulated verification failure") }
                }
            }
            #expect(try UpdateBundle(at: current).version == "1.12.0")
            #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).sorted() == ["Azure timetracker.app", "staged.app"])
        }
    }
    @Test func refusesStaleVersionAndConcurrentInstallWithoutReplacingApp() throws {
        try temporary { root in
            let current = root.appendingPathComponent("Azure timetracker.app"), staged = root.appendingPathComponent("staged.app")
            try bundle(current, version: "1.12.0", build: 19); try bundle(staged, version: "1.13.0", build: 20)
            #expect(throws: (any Error).self) { try UpdateInstallation.replace(staged: staged, destination: current, expectedVersion: "1.11.0", expectedBuild: 18) { _ in } }
            try FileManager.default.createDirectory(at: root.appendingPathComponent(".azure-timetracker-update-lock"), withIntermediateDirectories: false)
            #expect(throws: (any Error).self) { try UpdateInstallation.replace(staged: staged, destination: current, expectedVersion: "1.12.0", expectedBuild: 19) { _ in } }
            #expect(try UpdateBundle(at: current).version == "1.12.0")
        }
    }
}

import Foundation

public struct DiscoveredRepository: Identifiable, Equatable, Sendable {
    public var id: String { path }
    public let path: String
    public let branch: String
    public var name: String { URL(fileURLWithPath: path).lastPathComponent }
}

public struct RepositoryScan: Sendable {
    public var repositories: [DiscoveredRepository] = []
    public var issues: [String] = []
}

public enum RepositoryDiscovery {
    public static func canonicalPath(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
    }

    /// Read-only traversal. Never follows directory links or enters Git metadata or app packages.
    public static func scan(_ folder: URL, cancelled: () -> Bool = { false }) throws -> RepositoryScan {
        let root = folder.standardizedFileURL.resolvingSymlinksInPath()
        let manager = FileManager.default
        guard try root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
            throw AppError.message("Choose a folder to scan for Git repositories.")
        }
        var result = RepositoryScan()
        var seen = Set<String>()
        func inspect(_ url: URL) {
            guard manager.fileExists(atPath: url.appendingPathComponent(".git").path) else { return }
            do {
                let snapshot = try GitProbe.read(path: url.path)
                let path = canonicalPath(url.path)
                if seen.insert(path).inserted { result.repositories.append(DiscoveredRepository(path: path, branch: snapshot.label)) }
            } catch { result.issues.append(url.path + ": " + error.localizedDescription) }
        }
        if cancelled() { throw CancellationError() }
        inspect(root)
        let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey, .isPackageKey]
        guard let entries = manager.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsPackageDescendants], errorHandler: { url, error in
            result.issues.append(url.path + ": " + error.localizedDescription); return true
        }) else { throw AppError.message("This folder could not be read. Check its access permissions.") }
        for case let url as URL in entries {
            if cancelled() { throw CancellationError() }
            if url.lastPathComponent == ".git" { entries.skipDescendants(); continue }
            do {
                let values = try url.resourceValues(forKeys: Set(keys))
                if values.isSymbolicLink == true || values.isPackage == true { entries.skipDescendants(); continue }
                if values.isDirectory == true { inspect(url) }
            } catch { result.issues.append(url.path + ": " + error.localizedDescription) }
        }
        result.repositories.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        return result
    }

    /// Selections add new roots without duplicating or enabling existing paused repositories.
    public static func adding(_ paths: [String], to existing: [Repository]) -> [Repository] {
        var known = Set(existing.map { canonicalPath($0.path) })
        return existing + paths.compactMap { path in
            let canonical = canonicalPath(path)
            return known.insert(canonical).inserted ? Repository(path: canonical) : nil
        }
    }
}

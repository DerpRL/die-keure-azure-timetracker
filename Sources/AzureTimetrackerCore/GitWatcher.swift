import Foundation

public enum BranchPolicy {
    public static func suggestsBreak(_ branch: String) -> Bool {
        let family = branch.lowercased().split(separator: "/").first
        return family == "develop" || family == "long-feature"
    }
}

public enum BranchTicket {
    public static func extract(from branch: String, pattern: String) throws -> Int? {
        guard !BranchPolicy.suggestsBreak(branch) else { return nil }
        let regex = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        guard regex.numberOfCaptureGroups >= 1 else {
            throw AppError.message("The branch pattern needs a capture group for the ticket number, such as ([0-9]+).")
        }
        let matches = regex.matches(in: branch, range: NSRange(branch.startIndex..., in: branch))
        let ids = Set(matches.compactMap { match -> Int? in
            guard let range = Range(match.range(at: 1), in: branch), let id = Int(branch[range]), id > 0, id <= Int32.max else { return nil }
            return id
        })
        // Ambiguous branches require the user to select a ticket.
        return ids.count == 1 ? ids.first : nil
    }
}

public struct GitSnapshot: Equatable, Sendable {
    public var branch: String?
    public var head: String
    public var label: String { branch ?? "Detached HEAD" }
    public init(branch: String?, head: String) { self.branch = branch; self.head = head }
}

public enum GitProbe {
    public static func read(path: String) throws -> GitSnapshot {
        let root = URL(fileURLWithPath: path, isDirectory: true)
        var git = root.appendingPathComponent(".git")
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: git.path, isDirectory: &directory) else {
            throw AppError.message("No Git repository at \(root.lastPathComponent). Choose its root folder.")
        }
        if !directory.boolValue {
            let pointer = try String(contentsOf: git, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
            guard pointer.hasPrefix("gitdir: ") else { throw AppError.message("Invalid .git file in \(root.lastPathComponent).") }
            let location = String(pointer.dropFirst(8))
            git = location.hasPrefix("/") ? URL(fileURLWithPath: location) : root.appendingPathComponent(location)
        }
        let data = try Data(contentsOf: git.appendingPathComponent("HEAD"))
        guard data.count < 8192, let raw = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            throw AppError.message("Git HEAD is temporarily unreadable.")
        }
        if raw.hasPrefix("ref: refs/heads/") {
            return GitSnapshot(branch: String(raw.dropFirst(16)), head: raw)
        }
        guard raw.range(of: #"^[0-9a-fA-F]{40,64}$"#, options: .regularExpression) != nil else {
            throw AppError.message("Git HEAD is temporarily unreadable.")
        }
        return GitSnapshot(branch: nil, head: raw)
    }
}

public struct BranchChange: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var repositoryID: UUID
    public var repositoryName: String
    public var branch: String
    public var previousBranch: String?
    public var ticketID: Int?
    public var detectedAt: Date
    public var suggestsBreak: Bool { BranchPolicy.suggestsBreak(branch) }
    public init(repository: Repository, branch: String, previousBranch: String?, ticketID: Int?) {
        id = UUID(); repositoryID = repository.id; repositoryName = repository.name
        self.branch = branch; self.previousBranch = previousBranch; self.ticketID = ticketID; detectedAt = Date()
    }
}

/// Requires two matching samples. Git rewrites HEAD atomically, and transient
/// intermediate checkouts should not create an actionable stale notification.
public struct BranchDebouncer: Sendable {
    private var committed: [UUID: GitSnapshot] = [:]
    private var candidates: [UUID: GitSnapshot] = [:]
    public init() {}
    public mutating func sample(_ snapshot: GitSnapshot, repository: UUID) -> (old: GitSnapshot?, new: GitSnapshot)? {
        guard committed[repository] != snapshot else { candidates[repository] = nil; return nil }
        guard candidates[repository] == snapshot else { candidates[repository] = snapshot; return nil }
        let old = committed[repository]
        committed[repository] = snapshot; candidates[repository] = nil
        return (old, snapshot)
    }
    public mutating func retain(_ ids: Set<UUID>) {
        committed = committed.filter { ids.contains($0.key) }; candidates = candidates.filter { ids.contains($0.key) }
    }
}

public struct AuditEntry: Codable, Identifiable, Sendable {
    public var id = UUID()
    public var date = Date()
    public var title: String
    public var detail: String
    public init(_ title: String, detail: String) { self.title = title; self.detail = detail }
}

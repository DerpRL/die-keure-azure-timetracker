import Foundation
import Testing
@testable import AzureTimetrackerCore

@Suite struct RepositoryDiscoveryTests {
    private func repository(_ root: URL, _ path: String) throws -> URL {
        let repo = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: repo.appendingPathComponent(".git"), withIntermediateDirectories: true)
        try "ref: refs/heads/feature/123-task\n".write(to: repo.appendingPathComponent(".git/HEAD"), atomically: true, encoding: .utf8)
        return repo
    }
    @Test func nestedRepositoriesWorktreesAndRoot() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let parent = try repository(root, "group/project")
        let nested = try repository(parent, "nested project")
        let hidden = try repository(root, ".hidden/project")
        let worktree = root.appendingPathComponent("group/worktree")
        try FileManager.default.createDirectory(at: parent.appendingPathComponent(".git/worktrees/test"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: worktree, withIntermediateDirectories: true)
        try "gitdir: ../project/.git/worktrees/test\n".write(to: worktree.appendingPathComponent(".git"), atomically: true, encoding: .utf8)
        try "ref: refs/heads/feature/456-other\n".write(to: parent.appendingPathComponent(".git/worktrees/test/HEAD"), atomically: true, encoding: .utf8)
        let result = try RepositoryDiscovery.scan(root)
        #expect(result.repositories.map(\.path).sorted() == [parent, nested, hidden, worktree].map { RepositoryDiscovery.canonicalPath($0.path) }.sorted())
        #expect(result.issues.isEmpty)
        #expect(try RepositoryDiscovery.scan(parent).repositories.count == 2)
    }
    @Test func ignoresGitMetadataAndDirectoryLinksAndReportsInvalidRoots() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = try repository(root, "project")
        _ = try repository(repo, ".git/should-not-discover")
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("loop"), withDestinationURL: root)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("alias"), withDestinationURL: repo)
        let broken = root.appendingPathComponent("broken/.git")
        try FileManager.default.createDirectory(at: broken, withIntermediateDirectories: true)
        let result = try RepositoryDiscovery.scan(root)
        #expect(result.repositories.count == 1)
        #expect(result.issues.count == 1)
        #expect(result.issues[0].contains("broken"))
    }
    @Test func emptyInvalidAndCancelledScans() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(try RepositoryDiscovery.scan(root).repositories.isEmpty)
        #expect(throws: CancellationError.self) { try RepositoryDiscovery.scan(root, cancelled: { true }) }
        #expect(throws: (any Error).self) { try RepositoryDiscovery.scan(root.appendingPathComponent("missing")) }
    }
    @Test func selectedPathsDoNotDuplicateOrEnableExistingPausedRepositories() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try repository(root, "first"), second = try repository(root, "second")
        let alias = root.appendingPathComponent("alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: first)
        let existing = Repository(path: first.path, enabled: false)
        let result = RepositoryDiscovery.adding([alias.path, second.path, second.path], to: [existing])
        #expect(result.count == 2)
        #expect(result[0] == existing)
        #expect(result[1].enabled)
        #expect(result[1].path == RepositoryDiscovery.canonicalPath(second.path))
    }
}

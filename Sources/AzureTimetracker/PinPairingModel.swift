import Foundation
import Combine
import AzureTimetrackerCore

@MainActor final class PinPairingModel: ObservableObject {
    @Published private(set) var pin: String?
    @Published private(set) var expiresAt: Date?
    @Published private(set) var busy = false
    @Published private(set) var status: String?
    @Published private(set) var pairedHost: String?
    private var task: Task<Void, Never>?
    private var generation = UUID()

    func cancel() {
        generation = UUID(); task?.cancel(); task = nil
        pin = nil; expiresAt = nil; busy = false; status = nil; pairedHost = nil
    }
    func begin(workspace: String) {
        cancel(); busy = true
        let current = generation
        task = Task { [weak self] in
            guard let self else { return }
            defer { if generation == current { busy = false; pin = nil; expiresAt = nil } }
            do {
                let base = try Endpoint.sevenPace(workspace)
                let oauth = try SevenPaceOAuth(workspace: base)
                status = "Requesting a PIN…"
                let deadline = Date().addingTimeInterval(60)
                let code = try await oauth.createPIN()
                guard generation == current, !Task.isCancelled else { return }
                pin = code.pin; expiresAt = deadline
                status = "Enter this PIN in 7pace → Apps → Pair Mobile App. Waiting for approval…"
                while Date() < deadline {
                    try await Task.sleep(for: .seconds(2))
                    guard Date() < deadline else { break }
                    let result = try await oauth.status(secret: code.secret)
                    guard generation == current, !Task.isCancelled else { return }
                    if result == .expired { break }
                    if result == .validated {
                        let credentials = try await oauth.exchange(secret: code.secret)
                        guard generation == current, !Task.isCancelled else { return }
                        try SecretStore.saveOAuth(credentials, scope: base.host!)
                        pairedHost = base.host!
                        status = "Paired with \(base.host!). Save changes to use this connection."
                        return
                    }
                }
                status = "The PIN expired. Request a new PIN and enter it within one minute."
            } catch {
                guard generation == current, !Task.isCancelled else { return }
                status = "Could not pair with 7pace. " + error.localizedDescription
            }
        }
    }
}

extension SecretStore {
    @MainActor static func readOAuth(scope: String) throws -> SevenPaceTokens? {
        guard let raw = try read(account(kind: "7pace-oauth", scope: scope)) else { return nil }
        guard let tokens = try? JSONDecoder().decode(SevenPaceTokens.self, from: Data(raw.utf8)) else {
            throw AppError.message("The saved 7pace pairing could not be read. Pair again in Settings.")
        }
        return tokens
    }
    @MainActor static func saveOAuth(_ tokens: SevenPaceTokens, scope: String) throws {
        let raw = String(decoding: try JSONEncoder().encode(tokens), as: UTF8.self)
        try save(raw, account: account(kind: "7pace-oauth", scope: scope))
    }
    @MainActor static func renewOAuth(_ next: SevenPaceTokens, replacing previous: SevenPaceTokens, scope: String) throws {
        // A stale client must not overwrite credentials from a newer PIN pairing.
        guard try readOAuth(scope: scope) == previous else {
            throw AppError.message("7pace pairing changed. Reconnect to use the saved credentials.")
        }
        try saveOAuth(next, scope: scope)
    }
}

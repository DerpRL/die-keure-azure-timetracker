import Foundation

public enum UpdateTrust {
    public static let bundleID = "be.yarne.azure-timetracker"
    public static let repository = "DerpRL/die-keure-azure-timetracker"
    public static let feedURL = URL(string: "https://raw.githubusercontent.com/\(repository)/main/updates/latest.json")!
    public static let downloadsURL = URL(string: "https://github.com/\(repository)/tree/main/releases/latest")!
    // Update verification key only. The private signing key and SSH deploy key never belong in this repository.
    public static let publicKey = Data(base64Encoded: "hNlaBgWVfvdYQIeZJJPNcXEA//Lao+Ee2PTmEyCWl3Q=")!
    public static func assetURL(version: String) -> URL {
        URL(string: "https://raw.githubusercontent.com/\(repository)/main/releases/updates/\(version)/Azure-timetracker-\(version)-universal-update.zip")!
    }
}

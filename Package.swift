// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AzureTimetracker",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "AzureTimetracker", targets: ["AzureTimetracker"])],
    targets: [
        .target(name: "AzureTimetrackerCore"),
        .executableTarget(name: "AzureTimetracker", dependencies: ["AzureTimetrackerCore"]),
        .testTarget(name: "AzureTimetrackerCoreTests", dependencies: ["AzureTimetrackerCore"])
    ]
)

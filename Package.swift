// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AzureTimetracker",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "AzureTimetracker", targets: ["AzureTimetracker"]),
        .executable(name: "AzureTimetrackerUpdater", targets: ["AzureTimetrackerUpdater"]),
        .executable(name: "AzureTimetrackerRelease", targets: ["AzureTimetrackerRelease"])
    ],
    targets: [
        .target(name: "AzureTimetrackerCore"),
        .executableTarget(name: "AzureTimetracker", dependencies: ["AzureTimetrackerCore"]),
        .executableTarget(name: "AzureTimetrackerUpdater", dependencies: ["AzureTimetrackerCore"]),
        .executableTarget(name: "AzureTimetrackerRelease", dependencies: ["AzureTimetrackerCore"]),
        .testTarget(name: "AzureTimetrackerCoreTests", dependencies: ["AzureTimetrackerCore"])
    ]
)

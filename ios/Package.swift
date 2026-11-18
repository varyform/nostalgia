// swift-tools-version: 5.9
// Only for editors: SourceKit-LSP (Zed, VS Code) reads this to know the app's sources and
// that they're for iOS (with .sourcekit-lsp/config.json). Xcode builds the app from the
// project XcodeGen makes out of project.yml, as `mise run ios` does.
import PackageDescription

let package = Package(
    name: "Nostalgia",
    platforms: [.iOS(.v17)],
    targets: [
        .executableTarget(name: "Nostalgia", path: "Nostalgia"),
    ]
)

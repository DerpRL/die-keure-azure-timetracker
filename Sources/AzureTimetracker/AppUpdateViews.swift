import SwiftUI
import AzureTimetrackerCore

struct AppUpdateBanner: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var updates: AppUpdateModel
    var compact = false
    var body: some View {
        Group {
            if updates.release != nil || updates.installIssue != nil {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.down.app.fill").foregroundStyle(palette.accent)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(updates.installIssue != nil ? "Update needs attention" : updates.phase == .ready ? "Update ready to install" : "App update available")
                            .font(.callout.weight(.semibold))
                        if !compact { Text(updates.message).font(.caption).foregroundStyle(palette.secondary).lineLimit(2) }
                    }
                    Spacer(minLength: 4)
                    Button("View update") { model.revealWindow?(); updates.showDetails = true }
                        .accessibilityLabel("View app update details")
                }.padding(compact ? 10 : 14).background(palette.accent.opacity(0.10))
            }
        }
        // Only the main-window instance owns the sheet. A popover can close when the window opens.
        .sheet(isPresented: Binding(get: { !compact && updates.showDetails }, set: { if !compact { updates.showDetails = $0 } })) {
            InterfaceSheet(interface: model.interface) {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("App updates").font(.title2.bold())
                    Spacer()
                    Button("Done") { updates.showDetails = false }.keyboardShortcut(.cancelAction)
                }
                ScrollView { UpdateDetailsView(model: model, updates: updates) }
            }.padding(24).frame(width: 540, height: 500)
            }.interactiveDismissDisabled(updates.phase == .installing)
        }
    }
}

struct UpdateSettingsView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var updates: AppUpdateModel
    @Binding var automatic: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AppSectionHeading("App updates", subtitle: "Get new versions from the public GitHub repository.")
            Toggle("Check for updates automatically", isOn: $automatic)
            Text("Checks at startup and every minute. Downloading and restarting always require your choice.")
                .font(.callout).foregroundStyle(palette.secondary)
            Divider()
            UpdateDetailsView(model: model, updates: updates)
        }
    }
}

struct UpdateDetailsView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var updates: AppUpdateModel
    private var restartBlocked: Bool { model.busy || model.timeEditor.working || model.offlineDrafts.working || model.pinPairing.busy }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Installed version " + updates.installedVersion, systemImage: "checkmark.app").font(.headline)
            if let issue = updates.installIssue {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Installation needs attention", systemImage: "exclamationmark.triangle").font(.headline)
                    Text(issue).textSelection(.enabled)
                    Button("Dismiss message") { updates.dismissInstallIssue() }
                }.foregroundStyle(palette.warning).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(palette.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
            Text(updates.message).foregroundStyle(updates.phase == .failed ? palette.warning : palette.secondary).textSelection(.enabled)
            if let checked = updates.checkedAt {
                Text("Last checked: " + checked.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(palette.secondary)
            }
            if let release = updates.release {
                Divider()
                HStack {
                    Text("Version " + release.version).font(.title3.bold())
                    Spacer()
                    Text(ByteCountFormatter.string(fromByteCount: Int64(release.size), countStyle: .file)).foregroundStyle(palette.secondary)
                }
                Text(release.notes).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                if updates.phase == .downloading {
                    ProgressView(value: Double(updates.downloaded), total: Double(release.size))
                        .accessibilityLabel("Update download").accessibilityValue("\(Int(Double(updates.downloaded) / Double(release.size) * 100)) percent")
                    Button("Cancel download") { updates.cancelDownload() }
                } else if updates.phase == .ready {
                    Text("Restarting keeps your 7pace timer running. Save any open edits first.")
                        .font(.callout).foregroundStyle(palette.secondary)
                    Button("Install and restart") { model.installUpdate() }
                        .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white)
                        .disabled(restartBlocked || model.preview)
                    if restartBlocked { Text("Waiting for the current operation to finish…").font(.caption) }
                } else if updates.canDownload {
                    Button("Download update") { updates.download() }.buttonStyle(.borderedProminent)
                        .tint(palette.action).foregroundStyle(.white).disabled(model.preview)
                }
            }
            if updates.phase == .checking || updates.phase == .installing { ProgressView().controlSize(.small) }
            HStack {
                Button("Check for updates") { updates.check() }.disabled(updates.inProgress || updates.phase == .ready || model.preview)
                Link("Download installer on GitHub", destination: UpdateTrust.downloadsURL)
            }
            Text("Downloads are verified with the app’s release key. macOS security and account permission prompts may still appear.")
                .font(.caption).foregroundStyle(palette.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

import AppKit
import SwiftUI
import AzureTimetrackerCore

struct RepositoryImportView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    let folder: URL
    @Environment(\.dismiss) private var dismiss
    @ViewState private var scan: RepositoryScan?
    @ViewState private var failure: String?
    @ViewState private var selected = Set<String>()
    @ViewState private var query = ""
    @ViewState private var issuesExpanded = false

    private var existing: Set<String> { Set(model.configuration.repositories.map { RepositoryDiscovery.canonicalPath($0.path) }) }
    private var visible: [DiscoveredRepository] {
        (scan?.repositories ?? []).filter { query.isEmpty || $0.path.localizedCaseInsensitiveContains(query) }
    }
    private var selectable: Set<String> { Set(visible.map(\.path)).subtracting(existing) }
    private var additions: Set<String> { selected.subtracting(existing) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionTitle(title: "Choose repositories", subtitle: "Select the Git repositories you want to watch.")
            Text(folder.path).font(.caption).foregroundStyle(palette.secondary).textSelection(.enabled)
            Text("Includes subfolders and Git worktrees. Git metadata, application packages and linked folders are skipped.")
                .font(.caption).foregroundStyle(palette.secondary)
            if let failure { Label(failure, systemImage: "exclamationmark.triangle").foregroundStyle(palette.warning) }
            else if let scan {
                HStack {
                    TextField("Search by name or path", text: $query).textFieldStyle(.roundedBorder)
                    Button("Select all shown") { selected.formUnion(selectable) }.disabled(selectable.isEmpty)
                    Button("Clear selection") { selected.removeAll() }.disabled(selected.isEmpty)
                }
                if scan.repositories.isEmpty {
                    EmptyState(symbol: "folder", title: "No repositories found", detail: "Choose a folder containing Git checkouts or worktrees.").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(visible) { repo in
                                Toggle(isOn: Binding(get: { existing.contains(repo.path) || selected.contains(repo.path) }, set: { if $0 { selected.insert(repo.path) } else { selected.remove(repo.path) } })) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        HStack { Text(repo.name).font(.headline); Spacer(); if existing.contains(repo.path) { Text("Already added").font(.caption) } }
                                        Text(repo.path).font(.caption).foregroundStyle(palette.secondary).lineLimit(2)
                                        Label(repo.branch, systemImage: "arrow.triangle.branch").font(.caption).foregroundStyle(palette.secondary)
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                }.toggleStyle(.checkbox).disabled(existing.contains(repo.path)).padding(12)
                                    .accessibilityLabel("Watch " + repo.name + ", " + repo.path)
                                Divider()
                            }
                        }
                    }.background(palette.card).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                if !scan.issues.isEmpty {
                    DisclosureGroup("\(scan.issues.count) folders could not be read", isExpanded: $issuesExpanded) {
                        ScrollView { Text(scan.issues.joined(separator: "\n")).font(.caption).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 90)
                    }.foregroundStyle(palette.warning)
                }
                Text("\(scan.repositories.count) found · \(additions.count) selected to add").font(.callout)
            } else {
                VStack(spacing: 12) { ProgressView(); Text("Scanning folders…") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Spacer(minLength: 0)
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Add selected (\(additions.count))") {
                    model.addRepositories(additions.sorted()); dismiss()
                }.buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white)
                    .keyboardShortcut(.defaultAction).disabled(scan == nil || additions.isEmpty)
            }
        }.padding(24).frame(width: 780, height: 590)
        .task {
            let root = folder
            let task = Task.detached(priority: .userInitiated) {
                try RepositoryDiscovery.scan(root, cancelled: { Task.isCancelled })
            }
            do {
                let result = try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
                try Task.checkCancellation()
                scan = result
            } catch is CancellationError { /* Closing the sheet cancels the scan. */ }
            catch { failure = error.localizedDescription }
        }
    }
}

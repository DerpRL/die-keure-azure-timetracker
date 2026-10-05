import SwiftUI
import AzureTimetrackerCore

struct LocalTimerView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var offline: OfflineDraftModel
    var compact = false
    var body: some View {
        if let draft = offline.active {
            VStack(alignment: .leading, spacing: 12) {
                Label("Local tracking · saved on this Mac", systemImage: "internaldrive").font(.headline)
                TimelineView(.periodic(from: .now, by: 1)) { tick in
                    TimerDisplay(seconds: LocalTimerDisplay.elapsed(draft, at: tick.date), indicator: .running,
                                 sessionID: draft.id.uuidString, todaySeconds: nil, dailyTarget: 0, totalsConfirmed: false,
                                 detail: "Not uploaded to 7pace")
                }
                Text(draft.ticketID.flatMap { draft.workspace == offline.workspace ? model.workItems[$0]?.title : nil } ?? draft.title)
                    .font(.callout.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                if draft.ticketID != nil, !draft.comment.isEmpty { Text(draft.comment).font(.caption).foregroundStyle(palette.secondary) }
                if draft.workspace != offline.workspace { Text("Workspace: " + draft.workspace).font(.caption).foregroundStyle(palette.warning) }
                HStack {
                    Button("Review drafts") { model.page = .offlineDrafts; model.revealWindow?() }
                    Spacer()
                    Button("Stop local timer") { offline.stop() }.disabled(offline.working)
                        .buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white)
                }
                if let issue = offline.issue { Text(issue).font(.caption).foregroundStyle(palette.warning) }
            }.padding(compact ? 0 : 22).frame(maxWidth: .infinity, alignment: .leading)
                .background(compact ? Color.clear : palette.card, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

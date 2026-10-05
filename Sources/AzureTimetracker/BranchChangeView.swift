import SwiftUI
import AzureTimetrackerCore

struct BranchPrompt: View {
    @ObservedObject var model: AppModel
    let change: BranchChange
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 12 : 16) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "arrow.triangle.branch").font(.title2.weight(.semibold)).foregroundStyle(Palette.warning)
                    .frame(width: 40, height: 40).background(Palette.warning.opacity(0.14), in: RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Branch changed").font(compact ? .headline : .title3.bold()).accessibilityAddTraits(.isHeader)
                    Text(change.repositoryName).font(.callout.weight(.medium)).foregroundStyle(Palette.secondary)
                }
                Spacer(minLength: 4)
                Text("Review").font(.caption.bold()).foregroundStyle(Palette.warning).padding(.horizontal, 9).padding(.vertical, 5)
                    .background(Palette.warning.opacity(0.14), in: Capsule())
            }
            VStack(alignment: .leading, spacing: 8) {
                if let previous = change.previousBranch { branchLine("From", branch: previous, emphasized: false) }
                branchLine("To", branch: change.branch, emphasized: true)
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.card.opacity(0.8), in: RoundedRectangle(cornerRadius: 9))
            if change.suggestsBreak {
                Text("This is an integration branch. Pause, stop or keep your timer.").font(.callout).foregroundStyle(Palette.secondary)
                BranchBreakActions(model: model, change: change)
            } else {
                if let id = change.ticketID {
                    Text("Suggested: #\(String(id))" + (model.workItems[id].map { " · " + $0.title } ?? ""))
                        .font(.callout.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    Text("Choose an activity to switch. Your timer stays unchanged until you confirm.").font(.caption).foregroundStyle(Palette.secondary)
                } else {
                    Text("No ticket number found. Choose a ticket or keep your timer.").font(.callout).foregroundStyle(Palette.secondary)
                }
                if compact {
                    VStack(alignment: .leading, spacing: 10) { primaryActions; if change.ticketID != nil { anotherTicket } }
                } else {
                    HStack { primaryActions; Spacer(); if change.ticketID != nil { anotherTicket } }
                }
            }
        }.padding(compact ? 16 : 22).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.warning.opacity(0.09), in: RoundedRectangle(cornerRadius: 15))
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(Palette.warning.opacity(0.65), lineWidth: 1.5))
            .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 3).fill(Palette.warning).frame(width: 4).padding(.vertical, 16).accessibilityHidden(true) }
    }
    private func branchLine(_ label: String, branch: String, emphasized: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary).frame(width: 34, alignment: .leading)
            Text(branch).font(.system(.callout, design: .monospaced).weight(emphasized ? .semibold : .regular))
                .foregroundStyle(emphasized ? Color.primary : Palette.secondary).lineLimit(compact ? 2 : 3).help(branch).textSelection(.enabled)
        }
    }
    private var primaryActions: some View {
        HStack {
            Button(model.state?.running == true ? "Keep tracking" : "Dismiss") { model.keep(change) }.disabled(model.busy)
            Button(change.ticketID.map { "Track #\(String($0))…" } ?? "Choose ticket…") {
                if compact { model.beginMenuTracking(change) }
                if let id = change.ticketID {
                    Task { await model.chooseActivity(for: id, change: change, inMenuBar: compact) }
                } else if !compact { model.selectedChange = change; model.showTicketPicker = true }
            }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
        }
    }
    private var anotherTicket: some View {
        Button("Choose another ticket…") {
            if compact { model.beginMenuTracking(change) }
            else { model.selectedChange = change; model.showTicketPicker = true }
        }.buttonStyle(.plain).foregroundStyle(Palette.accent).font(.callout).disabled(model.busy || !model.connected)
    }
}

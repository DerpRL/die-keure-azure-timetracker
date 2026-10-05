import SwiftUI
import AzureTimetrackerCore

struct TicketCompletionView: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    let prompt: TicketCompletionPrompt
    var inMenuBar = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Tracked ticket completed", systemImage: "checkmark.circle.fill").font(.headline).foregroundStyle(palette.accent)
            Text("#\(String(prompt.ticketID)) · " + prompt.title).font(.callout.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            Text("Azure status: " + prompt.workflowState + ". Your timer is still running.").font(.callout).foregroundStyle(palette.secondary)
            ViewThatFits(in: .horizontal) {
                HStack { actions }
                VStack(alignment: .leading, spacing: 10) { actions }
            }
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(palette.accent.opacity(0.45)))
    }
    @ViewBuilder private var actions: some View {
        Button("Keep tracking") { model.keepCompletedTicket() }.disabled(model.busy)
        Button("Stop") { Task { await model.stopTracking(afterCompletion: prompt) } }.disabled(model.busy || model.preview)
        Button("Switch ticket…") {
            if inMenuBar { model.beginMenuTracking() }
            else { model.selectedChange = nil; model.showTicketPicker = true }
        }.buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white).disabled(model.busy || model.preview)
    }
}

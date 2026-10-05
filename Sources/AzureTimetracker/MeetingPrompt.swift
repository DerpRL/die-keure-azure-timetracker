import SwiftUI
import AzureTimetrackerCore

struct MeetingPrompt: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    let meeting: MeetingEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Meeting started", systemImage: "calendar.badge.clock")
                .font(.caption.weight(.semibold)).foregroundStyle(palette.accent)
            Text(meeting.title).font(.callout.weight(.semibold)).lineLimit(3)
            Text(meeting.start.formatted(date: .omitted, time: .shortened) + " – " +
                 meeting.end.formatted(date: .omitted, time: .shortened) + " · " + meeting.calendar)
                .font(.caption).foregroundStyle(palette.secondary)
            if let id = model.meetingTicket(meeting) {
                Text(meeting.ticketID == nil ? "Default meeting ticket #\(String(id))" : "Linked ticket #\(String(id))")
                    .font(.caption).foregroundStyle(palette.accent)
            } else { Text("No ticket needed. The meeting title becomes the comment.").font(.caption).foregroundStyle(palette.secondary) }
            HStack {
                Button(model.state?.running == true ? "Keep current" : "Dismiss") { model.dismissMeeting(meeting) }
                Spacer()
                Button("Choose activity…") {
                    model.beginMeetingTracking(meeting)
                }.buttonStyle(.borderedProminent).tint(palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
            }
        }
    }
}

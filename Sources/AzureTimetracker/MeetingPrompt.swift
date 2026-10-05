import SwiftUI
import AzureTimetrackerCore

struct MeetingPrompt: View {
    @ObservedObject var model: AppModel
    let meeting: MeetingEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Meeting started", systemImage: "calendar.badge.clock")
                .font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
            Text(meeting.title).font(.callout.weight(.semibold)).lineLimit(3)
            Text(meeting.start.formatted(date: .omitted, time: .shortened) + " – " +
                 meeting.end.formatted(date: .omitted, time: .shortened) + " · " + meeting.calendar)
                .font(.caption).foregroundStyle(Palette.secondary)
            if let id = model.meetingTicket(meeting) {
                Text(meeting.ticketID == nil ? "Default meeting ticket #\(String(id))" : "Linked ticket #\(String(id))")
                    .font(.caption).foregroundStyle(Palette.accent)
            } else { Text("Choose an Azure ticket for this meeting.").font(.caption).foregroundStyle(Palette.secondary) }
            HStack {
                Button(model.state?.running == true ? "Keep current" : "Dismiss") { model.dismissMeeting(meeting) }
                Spacer()
                Button(model.meetingTicket(meeting) == nil ? "Choose ticket…" : "Choose activity…") {
                    model.beginMeetingTracking(meeting)
                }.buttonStyle(.borderedProminent).tint(Palette.action).foregroundStyle(.white).disabled(model.busy || !model.connected)
            }
        }
    }
}

#if UI_PREVIEW
// Isolated developer build only. The distribution does not include fixture code.
import Foundation
import SwiftUI
import AzureTimetrackerCore

extension AppModel {
    func prepareInterfacePreview() {
        configuration = Configuration(); configuration.watchEnabled = false
        configuration.sevenPaceURL = "https://preview.timehub.7pace.com/"
        let calendar = Calendar.current, today = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let start = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: today)!
        let data: [[String: Any]] = [
            ["id": "sample-a", "isCanEdit": true, "isCanDelete": true, "timestamp": WireDate.localString(start), "length": 7200, "workItemId": 33984,
             "comment": "Sample feature work", "activityType": ["id": "development", "name": "Development"]],
            ["id": "sample-adjacent", "isCanEdit": true, "isCanDelete": true, "timestamp": WireDate.localString(start.addingTimeInterval(2 * 3600)), "length": 3600, "workItemId": 33984,
             "comment": "Sample feature work", "activityType": ["id": "development", "name": "Development"]],
            ["id": "sample-b", "isCanEdit": true, "isCanDelete": true, "timestamp": WireDate.localString(start.addingTimeInterval(3 * 3600)), "length": 12600,
             "comment": "Sample planning session", "activityType": ["id": "planning", "name": "Planning"]]
        ]
        if let encoded = try? JSONSerialization.data(withJSONObject: data), let logs = try? JSONDecoder().decode([WorkLog].self, from: encoded) {
            dayReview.useInterfacePreview(logs)
            timeEditor.day = today; timeEditor.useInterfacePreview(logs)
            weeklyReport.useInterfacePreview(logs)
            var statisticsLogs = logs
            for offset in 2...300 {
                let date = calendar.date(byAdding: .day, value: -offset, to: start)!
                guard !calendar.isDateInWeekend(date) else { continue }
                let rows: [[String: Any]] = [
                    ["id": "statistics-preview-\(offset)", "timestamp": WireDate.localString(date), "length": Double(2 + offset % 3) * 3600, "billableLength": 7200, "workItemId": [33984, 33630, 34102][offset % 3], "activityType": ["id": "development", "name": "Development"]],
                    ["id": "review-preview-\(offset)", "timestamp": WireDate.localString(date.addingTimeInterval(5 * 3600)), "length": Double(1 + offset % 2) * 3600, "workItemId": [33984, 33630, 34102][(offset + 1) % 3], "comment": "Review feedback and tests", "activityType": ["id": "review", "name": "Code review"]],
                    ["id": "standup-preview-\(offset)", "timestamp": WireDate.localString(date.addingTimeInterval(-1800)), "length": 900, "activityType": ["id": "standup", "name": "Standup"]]
                ]
                if let encoded = try? JSONSerialization.data(withJSONObject: rows), let entries = try? JSONDecoder().decode([WorkLog].self, from: encoded) { statisticsLogs.append(contentsOf: entries) }
            }
            statistics.period = .week; statistics.anchor = today
            statistics.useInterfacePreview(statisticsLogs)
            activityTypes = (try? JSONDecoder().decode([ActivityType].self, from: Data(#"[{"id":"development","name":"Development"},{"id":"review","name":"Code review"},{"id":"standup","name":"Standup"}]"#.utf8))) ?? []
            offlineDrafts.preview(workspace: "https://preview.timehub.7pace.com/", activities: activityTypes)
        }
        configuration.pollSeconds = 300
        connected = true; hasSevenPaceToken = true; connectionHealth = .confirmed; lastSync = Date()
        state = try? JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":"idle"},"timestamp":1}"#.utf8))
        state = try? JSONDecoder().decode(TrackingState.self, from: Data(#"{"track":{"trackingState":"clientInputRequired","stoppedTrackType":4,"tfsId":33984,"workLogId":"preview-stopped","currentTrackLength":7200,"remark":"Sample feature work"}}"#.utf8))
        trackingAttention = state.flatMap(TrackingAttention.from)
        workItems[33984] = WorkItem(id: 33984, title: "Improve product context")
        workItems[33630] = WorkItem(id: 33630, title: "User journey tracking")
        workItems[34102] = WorkItem(id: 34102, title: "Export reliability and tests")
        progressLogs = (try? JSONDecoder().decode([WorkLog].self, from: JSONSerialization.data(withJSONObject: [data[0]]))) ?? []
        progressLastSync = Date(); progressWeek = TargetProgress.weekInterval(at: Date())
        previewTimer(.running, seconds: 3661)
        trackingAttention = nil
        configuration.organization = "preview"; hasAzurePAT = true
        let scope = configuration.sevenPaceURL.lowercased() + "|preview"
        ticketCompletion.observe(TicketWorkflowStatus(ticketID: 33984, title: "Improve product context", state: "Done", category: "Completed"), tracking: state, scope: scope, confirmed: true)
        pending = [BranchChange(repository: Repository(path: "/preview/Campus"), branch: "feature/33630-user-journey-tracking", previousBranch: "feature/33984-product-context", ticketID: 33630)]

    }

    func previewTimer(_ status: TrackingIndicator, seconds: Double? = nil) {
        let elapsed = seconds ?? self.elapsed(at: Date())
        let running = status == .running || status == .disconnected
        let track: [String: Any] = ["trackingState": running ? "tracking" : "idle", "tfsId": 33984,
                                   "workLogId": "animation-preview-active", "currentTrackLength": elapsed,
                                   "remark": "Sample feature work"]
        state = try? JSONDecoder().decode(TrackingState.self, from: JSONSerialization.data(withJSONObject: ["track": track]))
        pausedSession = status == .paused ? PausedSession(ticketID: 33984, activityID: nil, workspace: "preview", pausedAt: Date(), elapsedSeconds: elapsed) : nil
        connected = status != .disconnected; connectionHealth = connected ? .confirmed : .offline; lastSync = Date()
        progressLogs.removeAll { $0.id == "animation-preview-active" }
        if !running, elapsed > 0 {
            let item: [String: Any] = ["id": "animation-preview-active", "timestamp": WireDate.localString(Date().addingTimeInterval(-elapsed)), "length": elapsed]
            if let log = try? JSONDecoder().decode(WorkLog.self, from: JSONSerialization.data(withJSONObject: item)) { progressLogs.append(log) }
        }
    }
}

private struct TimerPreviewReduceMotionKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var timerPreviewReduceMotion: Bool {
        get { self[TimerPreviewReduceMotionKey.self] }
        set { self[TimerPreviewReduceMotionKey.self] = newValue }
    }
}

struct TimerAnimationPreview: View {
    @ObservedObject var model: AppModel
    @ViewState private var reduceMotion = false
    @ViewState private var lightAppearance = false
    var body: some View {
        HStack(alignment: .top, spacing: 38) {
            VStack(alignment: .leading, spacing: 18) {
                Text("Timer animation preview").font(.title).accessibilityAddTraits(.isHeader)
                Text("Isolated sample data. These controls never access an account or change a real timer.")
                Button("Start sample timer") { model.previewTimer(.running, seconds: 0) }
                Button("Pause sample timer") { model.previewTimer(.paused) }
                Button("Resume sample timer") { model.previewTimer(.running) }
                Button("Stop sample timer") { model.previewTimer(.stopped) }
                Button("Preview hour rollover") { model.previewTimer(.running, seconds: 3598) }
                Button("Preview reached target") { model.previewTimer(.running, seconds: 8 * 3600) }
                Button("Preview connection loss") { model.previewTimer(.disconnected) }
                Button("Preview unavailable totals") { model.progressLastSync = nil }
                Toggle("Reduce motion in preview", isOn: $reduceMotion)
                Toggle("Light appearance in preview", isOn: $lightAppearance)
            }.frame(width: 300)
            MenuPanel(model: model).frame(width: 420)
                .environment(\.timerPreviewReduceMotion, reduceMotion)
                .environment(\.colorScheme, lightAppearance ? .light : .dark)
        }.padding(40).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Palette.background).buttonStyle(.bordered).controlSize(.large).tint(Palette.accent)
    }
}
#endif

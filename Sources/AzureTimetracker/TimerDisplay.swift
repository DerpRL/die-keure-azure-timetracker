import SwiftUI
import AzureTimetrackerCore

/// Presentation only: the confirmed timer and existing worklog totals remain the source of truth.
struct TimerDisplay: View {
    @Environment(\.interfacePalette) private var palette

    let seconds: Double
    let indicator: TrackingIndicator
    let sessionID: String
    let todaySeconds: Double?
    let dailyTarget: Double
    let totalsConfirmed: Bool
    var detail: String? = nil
    var onDarkBackground = false
    var fontSize: CGFloat = 34
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    #if UI_PREVIEW
    @Environment(\.timerPreviewReduceMotion) private var previewReduceMotion
    #endif
    private var reduceMotion: Bool {
        #if UI_PREVIEW
        systemReduceMotion || previewReduceMotion
        #else
        systemReduceMotion
        #endif
    }

    private var fraction: Double? {
        guard dailyTarget.isFinite, dailyTarget > 0, let todaySeconds, todaySeconds.isFinite else { return nil }
        return min(1, max(0, todaySeconds / dailyTarget))
    }
    private var progressDescription: String {
        if let detail { return detail }
        guard dailyTarget > 0 else { return "No daily target today" }
        guard let fraction else { return "Daily total unavailable" }
        let percent = Int(fraction * 100)
        return (totalsConfirmed ? "Today · " : "Last known · ") + String(percent) + "% of daily target"
    }
    private var statusColor: Color {
        switch indicator {
        case .running: onDarkBackground ? .mint : palette.accent
        case .paused, .attention, .disconnected: onDarkBackground ? .yellow : palette.warning
        case .stopped, .connecting: onDarkBackground ? .white : palette.secondary
        }
    }
    var body: some View {
        HStack(spacing: 16) {
            clock
            VStack(alignment: .leading, spacing: 6) {
                RollingTimerText(seconds: seconds, running: indicator == .running, fontSize: fontSize, reduceMotion: reduceMotion)
                    // A different session starts cleanly instead of rolling backwards through its predecessor.
                    .id(sessionID)
                    .foregroundStyle(onDarkBackground ? Color.white : Color.primary)
                Text(progressDescription).font(.caption)
                    .foregroundStyle(onDarkBackground ? Color.white.opacity(0.9) : palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .transaction { if reduceMotion { $0.animation = nil; $0.disablesAnimations = true } }
    }

    private var clock: some View {
        ZStack {
            Circle().stroke(onDarkBackground ? Color.white.opacity(0.24) : palette.line, lineWidth: 3)
            if let fraction {
                Circle().trim(from: 0, to: fraction)
                    .stroke(statusColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .opacity(totalsConfirmed ? 1 : 0.55)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.35), value: fraction)
            }
            Circle().fill(statusColor.opacity(0.12)).padding(7)
            Image(systemName: "clock").font(.system(size: 24, weight: .regular)).foregroundStyle(statusColor)
                .phaseAnimator([false, true, false], trigger: indicator) { clock, emphasized in
                    clock.scaleEffect(!reduceMotion && indicator == .running && emphasized ? 1.08 : 1)
                        .opacity(!reduceMotion && indicator == .running && emphasized ? 0.78 : 1)
                } animation: { _ in reduceMotion ? nil : .easeInOut(duration: 0.18) }
            Image(systemName: badgeSymbol).font(.system(size: 9, weight: .bold))
                .foregroundStyle(statusColor)
                .frame(width: 18, height: 18)
                .background(onDarkBackground ? Color(red: 0.05, green: 0.35, blue: 0.34) : palette.card, in: Circle())
                .offset(x: 15, y: 15)
        }
        .frame(width: 64, height: 64).padding(2)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: indicator)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tracking clock")
        .accessibilityValue(indicator.label + ". " + progressDescription)
        .help(progressDescription)
    }
    private var badgeSymbol: String {
        switch indicator {
        case .running: "play.fill"
        case .paused: "pause.fill"
        case .stopped: "stop.fill"
        case .connecting: "arrow.triangle.2.circlepath"
        case .attention, .disconnected: "exclamationmark"
        }
    }
}

private struct RollingTimerText: View {
    let seconds: Double
    let running: Bool
    let fontSize: CGFloat
    let reduceMotion: Bool
    private var clockText: String { DurationText.clock(seconds.isFinite ? max(0, seconds) : 0) }
    private var sizeTemplate: String {
        String(repeating: "0", count: clockText.prefix(while: { $0 != ":" }).count) + ":00:00"
    }
    var body: some View {
        // Only this stationary template participates in layout. Numeric transitions
        // can change Text's temporary bounds and otherwise resize the hosting popover.
        Text(sizeTemplate).foregroundStyle(.clear)
            .overlay(alignment: Alignment(horizontal: .leading, vertical: .firstTextBaseline)) {
                Text(clockText)
                    .contentTransition(reduceMotion ? .identity : .numericText(countsDown: false))
                    .animation(reduceMotion || !running ? nil : .easeInOut(duration: 0.22), value: clockText)
                    .fixedSize()
            }
            .font(.system(size: fontSize, weight: .light, design: .rounded)).monospacedDigit()
            .fixedSize()
            .clipped()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Elapsed time")
            .accessibilityValue(clockText)
    }
}

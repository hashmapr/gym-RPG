import ActivityKit
import WidgetKit
import SwiftUI

// Sprint 7.5 — Live Activity lock-screen UI for the rest timer.
// RestActivityAttributes is duplicated from the app target (standard
// practice for simple setups): the name + Codable field names must match
// exactly for ActivityKit to bind the activity to this widget.

struct RestActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var endsAt: Double
        public var durationSec: Double
    }
}

private func restCountdownText(_ endsAt: Double) -> Text {
    Text(timerInterval: Date(timeIntervalSince1970: endsAt / 1000)...Date(timeIntervalSince1970: endsAt / 1000 + 1),
         countsDown: true)
        .monospacedDigit()
}

struct RestLockScreenView: View {
    let context: ActivityViewContext<RestActivityAttributes>

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("REST")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundColor(.white.opacity(0.6))
                    .kerning(1.5)
                Text("Overload")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundColor(.white.opacity(0.9))
            }
            Spacer()
            restCountdownText(context.state.endsAt)
                .font(.system(size: 34, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
        }
        .padding()
        .activityBackgroundTint(Color.black)
        .activitySystemActionForegroundColor(.white)
    }
}

struct RestActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestActivityAttributes.self) { context in
            RestLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("REST")
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundColor(.white.opacity(0.6))
                        .kerning(1.5)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    restCountdownText(context.state.endsAt)
                        .font(.system(size: 24, weight: .bold, design: .monospaced))
                        .foregroundColor(.white)
                }
            } compactLeading: {
                Text("R")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundColor(.white)
            } compactTrailing: {
                restCountdownText(context.state.endsAt)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundColor(.white)
                    .frame(maxWidth: 44)
            } minimal: {
                restCountdownText(context.state.endsAt)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundColor(.white)
            }
        }
    }
}

@main
struct OverloadWidgetBundle: WidgetBundle {
    var body: some Widget {
        RestActivityWidget()
    }
}
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


// MARK: - Sprint 7.8 home-screen widgets (App Group data bridge)

private let appGroupId = "group.personal.overload.app"

/// Keys written by OverloadNative.updateWidgets from the JS bridge.
private struct WidgetSnapshot {
    let streak: Int
    let todayTitle: String
    let todaySub: String
    let weekVolume: String
    let updatedAt: Date

    static func read() -> WidgetSnapshot {
        let d = UserDefaults(suiteName: appGroupId)
        return WidgetSnapshot(
            streak: d?.integer(forKey: "widgetStreak") ?? 0,
            todayTitle: d?.string(forKey: "widgetTodayTitle") ?? "No session",
            todaySub: d?.string(forKey: "widgetTodaySub") ?? "",
            weekVolume: d?.string(forKey: "widgetWeekVolume") ?? "—",
            updatedAt: Date(timeIntervalSince1970: (d?.double(forKey: "widgetUpdatedAt") ?? 0))
        )
    }
}

private let mono = Font.system(size: 11, weight: .semibold, design: .monospaced)

private struct StreakView: View {
    let snap: WidgetSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("STREAK")
                .font(mono).kerning(1.5)
                .foregroundColor(.white.opacity(0.55))
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\u{1F525}")
                Text("\(snap.streak)")
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .foregroundColor(.white)
                    .minimumScaleFactor(0.5)
            }
            Text("days")
                .font(mono).foregroundColor(.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.black)
    }
}

struct StreakWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OverloadStreakWidget", provider: SnapshotProvider()) { snap in
            StreakView(snap: snap)
                .containerBackground(.black, for: .widget)
        }
        .configurationDisplayName("Streak")
        .description("Current training streak.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    }
}

private struct TodayView: View {
    let snap: WidgetSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("TODAY")
                .font(mono).kerning(1.5)
                .foregroundColor(.white.opacity(0.55))
            Text(snap.todayTitle)
                .font(.system(size: 16, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
            if !snap.todaySub.isEmpty {
                Text(snap.todaySub)
                    .font(mono)
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.black)
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OverloadTodayWidget", provider: SnapshotProvider()) { snap in
            TodayView(snap: snap)
                .containerBackground(.black, for: .widget)
                .widgetURL(URL(string: "overload://today"))
        }
        .configurationDisplayName("Today")
        .description("Today's planned session. Tap to open Overload.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct WeekVolumeView: View {
    let snap: WidgetSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("WEEK VOLUME")
                .font(mono).kerning(1.5)
                .foregroundColor(.white.opacity(0.55))
            Text(snap.weekVolume)
                .font(.system(size: 22, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let ago = relative(snap.updatedAt) {
                Text(ago).font(mono).foregroundColor(.white.opacity(0.4))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.black)
    }
}

private func relative(_ date: Date) -> String? {
    let fmt = RelativeDateTimeFormatter()
    fmt.unitsStyle = .abbreviated
    return date.timeIntervalSince1970 > 0 ? fmt.localizedString(for: date, relativeTo: Date()) : nil
}

struct WeeklyVolumeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OverloadWeekVolumeWidget", provider: SnapshotProvider()) { snap in
            WeekVolumeView(snap: snap)
                .containerBackground(.black, for: .widget)
        }
        .configurationDisplayName("Weekly volume")
        .description("Rolling 7-day tonnage.")
        .supportedFamilies([.systemSmall])
    }
}

/// Timeline provider: one entry now, refresh at top of the next hour (the
/// app reloads timelines on every sync anyway).
private struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snap: WidgetSnapshot
}

private struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snap: .read())
    }
    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snap: .read()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let entry = SnapshotEntry(date: Date(), snap: .read())
        let next = Calendar.current.nextDate(after: Date(), matching: DateComponents(minute: 0), matchingPolicy: .nextTime) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

/// Lock-screen accessory (iOS 16+): inline streak.
struct StreakAccessoryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OverloadStreakAccessory", provider: SnapshotProvider()) { snap in
            Text("\u{1F525} \(snap.streak)d")
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
                .containerBackground(.black, for: .widget)
        }
        .configurationDisplayName("Streak (lock screen)")
        .description("Streak inline on the lock screen.")
        .supportedFamilies([.accessoryInline, .accessoryCircular])
    }
}

@main
struct OverloadWidgetBundle: WidgetBundle {
    var body: some Widget {
        RestActivityWidget()
        StreakWidget()
        TodayWidget()
        WeeklyVolumeWidget()
        StreakAccessoryWidget()
    }

}
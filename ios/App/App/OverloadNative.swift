import Foundation
import Capacitor
import HealthKit
import ActivityKit
import WidgetKit

// Sprint 7.5 — OverloadNative: Live Activity rest timer (ActivityKit) +
// HealthKit reads (bodyweight, sleep). Registered in MainViewController.
//
// Live Activities: the JS bridge treats any failure as "notification-only
// fallback" (spec). A widget extension target renders the lock-screen UI;
// until it is added to the Xcode project, Activity.request fails here and
// the bridge falls back — by design, documented in SPRINT_REPORT.md.
//
// HealthKit: if the entitlement/authorization fails (free provisioning
// edge cases), reads reject → JS returns null → manual check-in fallback.

@objc(OverloadNative)
public class OverloadNative: CAPPlugin {

    private let healthStore = HKHealthStore()

    // MARK: - Live Activity (rest timer)

    @objc func startRestActivity(_ call: CAPPluginCall) {
        let endsAt = call.getDouble("endsAt") ?? (Date().timeIntervalSince1970 + 180) * 1000
        let durationSec = call.getDouble("durationSec") ?? 180
        // 16.2 gate: the 16.1 ActivityKit end/request signatures were
        // obsoleted in newer SDKs; 16.2 is the practical floor.
        guard #available(iOS 16.2, *) else {
            call.reject("ActivityKit requires iOS 16.2+")
            return
        }
        Task {
            do {
                let attributes = RestActivityAttributes()
                let state = RestActivityAttributes.ContentState(
                    endsAt: endsAt,
                    durationSec: durationSec
                )
                // 16.1 API (contentState:) — our gate is 16.1, not 16.2.
                _ = try Activity<RestActivityAttributes>.request(
                    attributes: attributes,
                    contentState: state,
                    pushType: nil
                )
                call.resolve()
            } catch {
                call.reject("Live Activity request failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func stopRestActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<RestActivityAttributes>.activities {
                // 16.1 API: end with explicit final state + policy.
                await activity.end(
                    ActivityContent(state: RestActivityAttributes.ContentState(
                        endsAt: Date().timeIntervalSince1970 * 1000,
                        durationSec: 0
                    ), staleDate: Date()),
                    dismissalPolicy: .immediate
                )
            }
            call.resolve()
        }
    }

    // MARK: - HealthKit

    @objc func readLatestBodyweight(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit unavailable")
            return
        }
        guard let bodyMass = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
            call.reject("bodyMass type unavailable")
            return
        }
        healthStore.requestAuthorization(toShare: nil, read: [bodyMass]) { [weak self] granted, error in
            if let error = error {
                call.reject("HealthKit auth failed: \(error.localizedDescription)")
                return
            }
            guard granted, let self = self else {
                call.reject("HealthKit auth denied")
                return
            }
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
            let query = HKSampleQuery(sampleType: bodyMass, predicate: nil, limit: 1, sortDescriptors: [sort]) { _, samples, error in
                if let error = error {
                    call.reject("HealthKit query failed: \(error.localizedDescription)")
                    return
                }
                guard let sample = samples?.first as? HKQuantitySample else {
                    call.resolve(["lb": nil, "at": nil])
                    return
                }
                let lb = sample.quantity.doubleValue(for: HKUnit.pound())
                call.resolve([
                    "lb": lb,
                    "at": ISO8601DateFormatter().string(from: sample.endDate),
                ])
            }
            self.healthStore.execute(query)
        }
    }


    // MARK: - Sprint 7.8 home-screen widgets (App Group bridge)

    /// Writes the widget snapshot into the shared App Group container and
    /// reloads all widget timelines. Called after finish/sync from the JS
    /// bridge; a no-op failure never blocks the caller.
    @objc func updateWidgets(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: "group.personal.overload.app") else {
            call.reject("App Group unavailable")
            return
        }
        defaults.set(call.getInt("streak") ?? 0, forKey: "widgetStreak")
        defaults.set(call.getString("todayTitle") ?? "", forKey: "widgetTodayTitle")
        defaults.set(call.getString("todaySub") ?? "", forKey: "widgetTodaySub")
        defaults.set(call.getString("weekVolume") ?? "", forKey: "widgetWeekVolume")
        defaults.set(Date().timeIntervalSince1970, forKey: "widgetUpdatedAt")
        #if arch(arm64) || arch(x86_64)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
        call.resolve()
    }

    @objc func readSleepHours(_ call: CAPPluginCall) {
        let sinceDays = call.getDouble("sinceDays") ?? 1
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit unavailable")
            return
        }
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            call.reject("sleepAnalysis type unavailable")
            return
        }
        healthStore.requestAuthorization(toShare: nil, read: [sleepType]) { [weak self] granted, error in
            if let error = error {
                call.reject("HealthKit auth failed: \(error.localizedDescription)")
                return
            }
            guard granted, let self = self else {
                call.reject("HealthKit auth denied")
                return
            }
            let start = Calendar.current.date(byAdding: .day, value: -Int(sinceDays), to: Date())!
            let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
            let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: 500, sortDescriptors: nil) { _, samples, error in
                if let error = error {
                    call.reject("HealthKit query failed: \(error.localizedDescription)")
                    return
                }
                // HKCategoryValueSleepAnalysis asleep stages (16.0+); raw
                // values avoid availability gates: 2=unspecified, 3=core,
                // 4=deep, 5=REM.
                let asleepValues: Set<Int> = [2, 3, 4, 5]
                var seconds = 0.0
                for sample in (samples ?? []) as? [HKCategorySample] ?? [] where asleepValues.contains(sample.value) {
                    seconds += sample.endDate.timeIntervalSince(sample.startDate)
                }
                call.resolve(["hours": seconds / 3600.0])
            }
            self.healthStore.execute(query)
        }
    }
}

// MARK: - ActivityKit attributes (shared shape for the future widget target)

@available(iOS 16.2, *)
public struct RestActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /** Epoch ms — drives Text(timerInterval:) in the widget UI. */
        public var endsAt: Double
        public var durationSec: Double

        public init(endsAt: Double, durationSec: Double) {
            self.endsAt = endsAt
            self.durationSec = durationSec
        }
    }

    public var name: String

    public init(name: String = "Rest") {
        self.name = name
    }
}
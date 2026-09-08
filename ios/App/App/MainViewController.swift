import UIKit
import Capacitor

// App entry view controller — registers the OverloadNative plugin
// (Live Activity rest timer + HealthKit reads).

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OverloadNative())
    }
}
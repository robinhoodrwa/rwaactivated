import Capacitor

@objc(MainViewController)
final class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AssetScannerPlugin())
    }
}

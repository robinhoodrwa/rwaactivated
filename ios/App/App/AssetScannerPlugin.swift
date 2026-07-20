import ARKit
import Capacitor
import SceneKit
import UIKit

@objc(AssetScannerPlugin)
final class AssetScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "AssetScannerPlugin"
    let jsName = "AssetScanner"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    private weak var scannerViewController: AssetScannerViewController?

    @objc func scan(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) else {
            call.reject("LiDAR mesh scanning requires a supported iPhone Pro or iPad Pro. You can still import an OBJ scan from Files.", "LIDAR_UNAVAILABLE")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("The native scanner could not open.", "SCANNER_UNAVAILABLE")
                return
            }

            let scanner = AssetScannerViewController()
            scanner.modalPresentationStyle = .fullScreen
            scanner.onCancel = { [weak self, weak scanner] in
                scanner?.dismiss(animated: true)
                self?.scannerViewController = nil
                call.reject("Asset scan cancelled.", "SCAN_CANCELLED")
            }
            scanner.onComplete = { [weak self, weak scanner] result in
                scanner?.dismiss(animated: true)
                self?.scannerViewController = nil
                call.resolve([
                    "fileName": result.fileName,
                    "obj": result.obj,
                    "vertexCount": result.vertexCount,
                    "faceCount": result.faceCount
                ])
            }
            self.scannerViewController = scanner
            presenter.present(scanner, animated: true)
        }
    }
}

private struct AssetScanResult {
    let fileName: String
    let obj: String
    let vertexCount: Int
    let faceCount: Int
}

private final class AssetScannerViewController: UIViewController, ARSCNViewDelegate {
    var onCancel: (() -> Void)?
    var onComplete: ((AssetScanResult) -> Void)?

    private let sceneView = ARSCNView(frame: .zero)
    private let statusLabel = UILabel()
    private let finishButton = UIButton(type: .system)
    private var meshAnchors: [UUID: ARMeshAnchor] = [:]
    private let meshLock = NSLock()
    private var isExporting = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureScene()
        configureOverlay()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startSession()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
    }

    private func configureScene() {
        sceneView.translatesAutoresizingMaskIntoConstraints = false
        sceneView.automaticallyUpdatesLighting = true
        sceneView.delegate = self
        view.addSubview(sceneView)
        NSLayoutConstraint.activate([
            sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            sceneView.topAnchor.constraint(equalTo: view.topAnchor),
            sceneView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        let coachingOverlay = ARCoachingOverlayView()
        coachingOverlay.translatesAutoresizingMaskIntoConstraints = false
        coachingOverlay.session = sceneView.session
        coachingOverlay.goal = .tracking
        coachingOverlay.activatesAutomatically = true
        view.addSubview(coachingOverlay)
        NSLayoutConstraint.activate([
            coachingOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            coachingOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            coachingOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            coachingOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func configureOverlay() {
        let header = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        header.translatesAutoresizingMaskIntoConstraints = false
        header.layer.cornerRadius = 18
        header.clipsToBounds = true

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "Scan the complete asset"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 20, weight: .bold)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "Move slowly around every side. Green lines show captured geometry."
        statusLabel.textColor = UIColor.white.withAlphaComponent(0.82)
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.numberOfLines = 2

        header.contentView.addSubview(titleLabel)
        header.contentView.addSubview(statusLabel)
        view.addSubview(header)

        let cancelButton = makeButton(title: "Cancel", background: UIColor.black.withAlphaComponent(0.62))
        cancelButton.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)

        finishButton.translatesAutoresizingMaskIntoConstraints = false
        finishButton.setTitle("Finish scan", for: .normal)
        finishButton.setTitleColor(.black, for: .normal)
        finishButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .bold)
        finishButton.backgroundColor = UIColor(red: 0.62, green: 0.87, blue: 0.36, alpha: 1)
        finishButton.layer.cornerRadius = 14
        finishButton.isEnabled = false
        finishButton.alpha = 0.48
        finishButton.addTarget(self, action: #selector(finishScan), for: .touchUpInside)

        let controls = UIStackView(arrangedSubviews: [cancelButton, finishButton])
        controls.translatesAutoresizingMaskIntoConstraints = false
        controls.axis = .horizontal
        controls.spacing = 12
        controls.distribution = .fillEqually
        view.addSubview(controls)

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            header.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            titleLabel.leadingAnchor.constraint(equalTo: header.contentView.leadingAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: header.contentView.trailingAnchor, constant: -16),
            titleLabel.topAnchor.constraint(equalTo: header.contentView.topAnchor, constant: 14),
            statusLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            statusLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 5),
            statusLabel.bottomAnchor.constraint(equalTo: header.contentView.bottomAnchor, constant: -14),
            controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            controls.heightAnchor.constraint(equalToConstant: 54)
        ])
    }

    private func makeButton(title: String, background: UIColor) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        button.backgroundColor = background
        button.layer.cornerRadius = 14
        return button
    }

    private func startSession() {
        let configuration = ARWorldTrackingConfiguration()
        configuration.sceneReconstruction = .mesh
        configuration.environmentTexturing = .automatic
        configuration.worldAlignment = .gravity
        sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
        guard let meshAnchor = anchor as? ARMeshAnchor else { return }
        store(meshAnchor)
        node.geometry = Self.makeMeshGeometry(meshAnchor.geometry)
    }

    func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
        guard let meshAnchor = anchor as? ARMeshAnchor else { return }
        store(meshAnchor)
        node.geometry = Self.makeMeshGeometry(meshAnchor.geometry)
    }

    func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
        guard anchor is ARMeshAnchor else { return }
        meshLock.lock()
        meshAnchors.removeValue(forKey: anchor.identifier)
        meshLock.unlock()
        updateStatus()
    }

    private func store(_ meshAnchor: ARMeshAnchor) {
        meshLock.lock()
        meshAnchors[meshAnchor.identifier] = meshAnchor
        meshLock.unlock()
        updateStatus()
    }

    private static func makeMeshGeometry(_ mesh: ARMeshGeometry) -> SCNGeometry {
        let vertices = SCNGeometrySource(
            buffer: mesh.vertices.buffer,
            vertexFormat: mesh.vertices.format,
            semantic: .vertex,
            vertexCount: mesh.vertices.count,
            dataOffset: mesh.vertices.offset,
            dataStride: mesh.vertices.stride
        )
        let faces = SCNGeometryElement(
            buffer: mesh.faces.buffer,
            primitiveType: .triangles,
            primitiveCount: mesh.faces.count,
            bytesPerIndex: mesh.faces.bytesPerIndex
        )
        let geometry = SCNGeometry(sources: [vertices], elements: [faces])
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = UIColor(red: 0.45, green: 1, blue: 0.48, alpha: 0.92)
        material.emission.contents = UIColor(red: 0.2, green: 0.82, blue: 0.28, alpha: 0.72)
        material.fillMode = .lines
        material.isDoubleSided = true
        geometry.materials = [material]
        return geometry
    }

    private func updateStatus() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.meshLock.lock()
            let count = self.meshAnchors.count
            self.meshLock.unlock()
            self.statusLabel.text = count == 0
                ? "Move slowly around the asset. Green mesh will appear as LiDAR captures it."
                : "Green mesh is saved. Keep moving to cover every side · \(count) sections."
            self.finishButton.isEnabled = count > 0 && !self.isExporting
            self.finishButton.alpha = self.finishButton.isEnabled ? 1 : 0.48
        }
    }

    @objc private func cancelScan() {
        guard !isExporting else { return }
        sceneView.session.pause()
        onCancel?()
    }

    @objc private func finishScan() {
        meshLock.lock()
        let hasMesh = !meshAnchors.isEmpty
        meshLock.unlock()
        guard !isExporting, hasMesh else { return }
        isExporting = true
        finishButton.isEnabled = false
        finishButton.alpha = 0.48
        finishButton.setTitle("Preparing mesh…", for: .normal)
        sceneView.session.pause()
        meshLock.lock()
        let anchors = Array(meshAnchors.values)
        meshLock.unlock()

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let result = try Self.exportOBJ(from: anchors)
                DispatchQueue.main.async { self?.onComplete?(result) }
            } catch {
                DispatchQueue.main.async {
                    self?.isExporting = false
                    self?.finishButton.setTitle("Finish scan", for: .normal)
                    self?.updateStatus()
                    self?.showExportError(error.localizedDescription)
                }
            }
        }
    }

    private func showExportError(_ message: String) {
        let alert = UIAlertController(title: "Scan could not be prepared", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Continue scanning", style: .default))
        present(alert, animated: true)
    }

    private static func exportOBJ(from anchors: [ARMeshAnchor]) throws -> AssetScanResult {
        let maximumVertices = 120_000
        let maximumFaces = 180_000
        var output = "# RWA Passport LiDAR asset scan\n"
        output.reserveCapacity(8_000_000)
        var vertexOffset = 1
        var vertexCount = 0
        var faceCount = 0

        for anchor in anchors {
            let geometry = anchor.geometry
            guard vertexCount + geometry.vertices.count <= maximumVertices else { continue }
            let remainingFaces = maximumFaces - faceCount
            guard remainingFaces > 0 else { break }

            for index in 0..<geometry.vertices.count {
                let local = vertex(at: index, in: geometry.vertices)
                let world = anchor.transform * SIMD4<Float>(local.x, local.y, local.z, 1)
                output += "v \(world.x) \(world.y) \(world.z)\n"
            }

            for index in 0..<geometry.normals.count {
                let local = vertex(at: index, in: geometry.normals)
                let transformed = anchor.transform * SIMD4<Float>(local.x, local.y, local.z, 0)
                let normal = simd_normalize(SIMD3<Float>(transformed.x, transformed.y, transformed.z))
                output += "vn \(normal.x) \(normal.y) \(normal.z)\n"
            }

            let facesToWrite = min(geometry.faces.count, remainingFaces)
            for faceIndex in 0..<facesToWrite {
                let base = faceIndex * geometry.faces.indexCountPerPrimitive
                let first = Int(index(at: base, in: geometry.faces)) + vertexOffset
                let second = Int(index(at: base + 1, in: geometry.faces)) + vertexOffset
                let third = Int(index(at: base + 2, in: geometry.faces)) + vertexOffset
                output += "f \(first)//\(first) \(second)//\(second) \(third)//\(third)\n"
            }

            vertexOffset += geometry.vertices.count
            vertexCount += geometry.vertices.count
            faceCount += facesToWrite
        }

        guard vertexCount >= 100, faceCount >= 50 else {
            throw NSError(domain: "AssetScanner", code: 1, userInfo: [NSLocalizedDescriptionKey: "Not enough geometry was captured. Move around the full asset, including its sides and top, then finish again."])
        }

        let timestamp = Int(Date().timeIntervalSince1970)
        return AssetScanResult(
            fileName: "rwa-asset-scan-\(timestamp).obj",
            obj: output,
            vertexCount: vertexCount,
            faceCount: faceCount
        )
    }

    private static func vertex(at index: Int, in source: ARGeometrySource) -> SIMD3<Float> {
        let pointer = source.buffer.contents().advanced(by: source.offset + source.stride * index)
        return pointer.assumingMemoryBound(to: SIMD3<Float>.self).pointee
    }

    private static func index(at index: Int, in element: ARGeometryElement) -> UInt32 {
        let pointer = element.buffer.contents().advanced(by: element.bytesPerIndex * index)
        switch element.bytesPerIndex {
        case 2:
            return UInt32(pointer.assumingMemoryBound(to: UInt16.self).pointee)
        case 4:
            return pointer.assumingMemoryBound(to: UInt32.self).pointee
        default:
            return UInt32(pointer.assumingMemoryBound(to: UInt8.self).pointee)
        }
    }
}

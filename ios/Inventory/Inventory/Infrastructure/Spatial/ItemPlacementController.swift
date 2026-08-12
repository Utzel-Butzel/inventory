import ARKit
import CoreImage
import RealityKit
import SwiftUI
import UIKit
import simd

@MainActor
final class ItemPlacementController: UIViewController, @preconcurrency ARSessionDelegate {
    var onTracking: ((String, Bool) -> Void)?
    var onRoomChanged: ((SpatialRoomScanSummary?) -> Void)?
    var onCaptured: ((Result<(SpatialPlacementDraft, Data), Error>) -> Void)?

    private let worldMapData: Data
    private let roomCandidates: [SpatialRoomDetectionCandidate]
    private var activeRoomScan: SpatialRoomScanSummary?
    private var containmentTracker: SpatialRoomContainmentTracker
    private var arView: ARView!
    private var coachingOverlay: ARCoachingOverlayView!
    private var lastCaptureRequest = 0
    private var captureInProgress = false
    private var trackingReady = false
    private var relocalizationGate = SpatialRelocalizationGate()
    private var previewAnchor: AnchorEntity?
    private var lastTrackingMessage: String?
    private var lastTrackingReadiness: Bool?
    private var relocalizationTimeoutTask: Task<Void, Never>?
    private var isStopped = false
    private var lastManualRoomRequest = 0

    init(
        worldMapData: Data,
        roomScan: SpatialRoomScanSummary,
        roomCandidates: [SpatialRoomDetectionCandidate]
    ) {
        self.worldMapData = worldMapData
        let normalizedCandidates = roomCandidates.filter {
            $0.scan.coordinateSpaceID == roomScan.coordinateSpaceID || roomScan.coordinateSpaceID == nil
        }
        self.roomCandidates = normalizedCandidates
        activeRoomScan = normalizedCandidates.count <= 1 ? roomScan : nil
        var tracker = SpatialRoomContainmentTracker(candidates: normalizedCandidates)
        if normalizedCandidates.count <= 1 {
            tracker.selectManually(scanID: roomScan.id)
        }
        containmentTracker = tracker
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        arView = ARView(frame: view.bounds)
        arView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        arView.automaticallyConfigureSession = false
        view.addSubview(arView)

        coachingOverlay = ARCoachingOverlayView()
        coachingOverlay.session = arView.session
        coachingOverlay.goal = .tracking
        coachingOverlay.activatesAutomatically = true
        coachingOverlay.frame = view.bounds
        coachingOverlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        coachingOverlay.backgroundColor = .clear
        view.addSubview(coachingOverlay)

        do {
            guard let worldMap = try NSKeyedUnarchiver.unarchivedObject(
                ofClass: ARWorldMap.self,
                from: worldMapData
            ) else {
                throw SpatialCaptureError.worldMapUnavailable
            }
            let configuration = ARWorldTrackingConfiguration()
            configuration.initialWorldMap = worldMap
            configuration.planeDetection = [.horizontal, .vertical]
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                configuration.frameSemantics.insert(.sceneDepth)
            }
            if ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
                configuration.sceneReconstruction = .meshWithClassification
            }
            arView.session.delegate = self
            arView.session.run(
                configuration,
                options: [.resetTracking, .removeExistingAnchors]
            )
            relocalizationGate.beginSearching()
            publishTracking("Zeige auf bekannte Wände oder Möbel, bis der Raum erkannt ist.", false)
            startRelocalizationTimeoutIfNeeded()
        } catch {
            reportSessionFailure(
                error,
                message: "Die gespeicherte Raumkarte konnte nicht geladen werden."
            )
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stop()
    }

    func stop() {
        guard !isStopped else { return }
        isStopped = true
        cancelRelocalizationTimeout()
        trackingReady = false
        arView?.session.delegate = nil
        arView?.session.pause()
    }

    func requestCapture(_ request: Int) {
        guard request != lastCaptureRequest else { return }
        lastCaptureRequest = request
        guard !isStopped, trackingReady, !captureInProgress,
              let roomScan = activeRoomScan
        else {
            publishTracking("Der Raum muss zuerst vollständig erkannt werden.", false)
            return
        }
        captureInProgress = true

        do {
            let measured = try measuredPointAtReticle()
            showPreview(at: measured.position)
            let orientation = measured.orientation
            var anchorTransform = simd_float4x4(orientation)
            anchorTransform.columns.3 = SIMD4<Float>(
                measured.position.x,
                measured.position.y,
                measured.position.z,
                1
            )
            let captureAnchor = ARAnchor(
                name: "inventory-placement",
                transform: anchorTransform
            )
            arView.session.add(anchor: captureAnchor)
            let draft = SpatialPlacementDraft(
                roomScanID: roomScan.id,
                roomName: roomScan.roomName,
                position: [
                    Double(measured.position.x),
                    Double(measured.position.y),
                    Double(measured.position.z),
                ],
                orientation: [
                    Double(orientation.vector.x),
                    Double(orientation.vector.y),
                    Double(orientation.vector.z),
                    Double(orientation.vector.w),
                ],
                confidence: measured.confidence,
                method: measured.method,
                anchorIdentifier: captureAnchor.identifier
            )

            arView.session.captureHighResolutionFrame { [weak self] frame, error in
                guard let self else { return }
                Task { @MainActor in
                    guard !self.isStopped else {
                        self.captureInProgress = false
                        return
                    }
                    defer { self.captureInProgress = false }
                    do {
                        if let error { throw error }
                        guard let frame else { throw SpatialCaptureError.imageUnavailable }
                        let data = try Self.jpegData(from: frame)
                        self.onCaptured?(.success((draft, data)))
                    } catch {
                        self.onCaptured?(.failure(error))
                    }
                }
            }
        } catch {
            captureInProgress = false
            onCaptured?(.failure(error))
        }
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        updateTracking(camera: camera)
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        updateTracking(camera: frame.camera)
        updateCurrentRoom(position: frame.camera.transform.translation)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        reportSessionFailure(
            SpatialCaptureError.sessionFailed(error.localizedDescription),
            message: "Die AR-Raumortung wurde beendet. Wähle den Raum erneut."
        )
    }

    func sessionWasInterrupted(_ session: ARSession) {
        guard !isStopped, !relocalizationGate.isFailed else { return }
        relocalizationGate.beginSearching()
        trackingReady = false
        startRelocalizationTimeoutIfNeeded()
        publishTracking("Die Raumortung wurde unterbrochen. Halte die Kamera weiter in den Raum.", false)
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        guard !isStopped, !relocalizationGate.isFailed else { return }
        relocalizationGate.beginSearching()
        trackingReady = false
        startRelocalizationTimeoutIfNeeded()
        publishTracking("Der gespeicherte Raum wird erneut gesucht …", false)
    }

    private func updateTracking(camera: ARCamera) {
        guard !isStopped, !relocalizationGate.isFailed else { return }
        switch camera.trackingState {
        case .normal:
            relocalizationGate.markReady()
            cancelRelocalizationTimeout()
            updateReadyState()
        case .limited(let reason):
            relocalizationGate.beginSearching()
            trackingReady = false
            startRelocalizationTimeoutIfNeeded()
            switch reason {
            case .relocalizing:
                publishTracking("Suche den gespeicherten Raum. Zeige auf markante Möbel oder Ecken.", false)
            case .insufficientFeatures:
                publishTracking("Zu wenige Details sichtbar. Bewege das iPhone auf Möbel oder Kanten.", false)
            case .excessiveMotion:
                publishTracking("Bewege das iPhone langsamer.", false)
            case .initializing:
                publishTracking("AR-Ortung wird gestartet …", false)
            @unknown default:
                publishTracking("Raumortung ist eingeschränkt.", false)
            }
        case .notAvailable:
            relocalizationGate.beginSearching()
            trackingReady = false
            startRelocalizationTimeoutIfNeeded()
            publishTracking("AR-Ortung ist derzeit nicht verfügbar.", false)
        @unknown default:
            relocalizationGate.beginSearching()
            trackingReady = false
            startRelocalizationTimeoutIfNeeded()
            publishTracking("Raumortung wird vorbereitet …", false)
        }
    }

    private func updateCurrentRoom(position: SIMD3<Float>) {
        guard !isStopped, relocalizationGate.isReady, !roomCandidates.isEmpty else { return }
        let previousID = activeRoomScan?.id
        let scanID = containmentTracker.update(position: [
            Double(position.x),
            Double(position.y),
            Double(position.z),
        ])
        activeRoomScan = roomCandidates.first { $0.scan.id == scanID }?.scan
        if activeRoomScan?.id != previousID {
            onRoomChanged?(activeRoomScan)
        }
        updateReadyState()
    }

    private func updateReadyState() {
        guard relocalizationGate.isReady else {
            trackingReady = false
            return
        }
        if roomCandidates.count <= 1, activeRoomScan == nil {
            activeRoomScan = roomCandidates.first?.scan
        }
        guard let activeRoomScan else {
            trackingReady = false
            publishTracking(
                "Struktur erkannt. Gehe weiter in einen gescannten Raum oder wähle ihn manuell.",
                false
            )
            return
        }
        trackingReady = true
        publishTracking(
            "\(activeRoomScan.roomName) erkannt. Richte das Fadenkreuz auf den Gegenstand.",
            true
        )
    }

    func selectRoomManually(scanID: UUID?, request: Int) {
        guard request != lastManualRoomRequest else { return }
        lastManualRoomRequest = request
        containmentTracker.selectManually(scanID: scanID)
        activeRoomScan = roomCandidates.first { $0.scan.id == scanID }?.scan
        onRoomChanged?(activeRoomScan)
        updateReadyState()
    }

    private func startRelocalizationTimeoutIfNeeded() {
        guard !isStopped,
              !relocalizationGate.isReady,
              !relocalizationGate.isFailed,
              relocalizationTimeoutTask == nil
        else { return }

        relocalizationTimeoutTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 45_000_000_000)
            } catch {
                return
            }
            guard let self, !self.isStopped else { return }
            self.relocalizationTimeoutTask = nil
            guard self.relocalizationGate.failIfSearching() else { return }
            self.trackingReady = false
            self.arView.session.pause()
            self.publishTracking(
                "Der Raum wurde nicht erkannt. Wähle ihn erneut und zeige auf markante Ecken.",
                false
            )
            self.onCaptured?(.failure(SpatialCaptureError.relocalizationFailed))
        }
    }

    private func cancelRelocalizationTimeout() {
        relocalizationTimeoutTask?.cancel()
        relocalizationTimeoutTask = nil
    }

    private func reportSessionFailure(_ error: Error, message: String) {
        guard !isStopped, relocalizationGate.fail() else { return }
        cancelRelocalizationTimeout()
        trackingReady = false
        arView?.session.pause()
        publishTracking(message, false)
        onCaptured?(.failure(error))
    }

    private func publishTracking(_ message: String, _ ready: Bool) {
        guard message != lastTrackingMessage || ready != lastTrackingReadiness else {
            return
        }
        lastTrackingMessage = message
        lastTrackingReadiness = ready
        onTracking?(message, ready)
    }

    func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool {
        true
    }

    private struct MeasuredPoint {
        let position: SIMD3<Float>
        let orientation: simd_quatf
        let confidence: Double
        let method: String
    }

    private func measuredPointAtReticle() throws -> MeasuredPoint {
        let point = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
        if let frame = arView.session.currentFrame,
           let depthPoint = depthPoint(at: point, frame: frame) {
            return MeasuredPoint(
                position: depthPoint.position,
                orientation: simd_quatf(angle: 0, axis: SIMD3<Float>(0, 1, 0)),
                confidence: depthPoint.highConfidence ? 0.94 : 0.86,
                method: "scene-depth"
            )
        }

        let existing = arView.raycast(
            from: point,
            allowing: .existingPlaneGeometry,
            alignment: .any
        )
        if let result = existing.first {
            return MeasuredPoint(
                position: result.worldTransform.translation,
                orientation: simd_quatf(result.worldTransform),
                confidence: 0.78,
                method: "plane-raycast"
            )
        }
        let estimated = arView.raycast(
            from: point,
            allowing: .estimatedPlane,
            alignment: .any
        )
        guard let result = estimated.first else {
            throw SpatialCaptureError.placementUnavailable
        }
        return MeasuredPoint(
            position: result.worldTransform.translation,
            orientation: simd_quatf(result.worldTransform),
            confidence: 0.68,
            method: "plane-raycast"
        )
    }

    private func depthPoint(
        at point: CGPoint,
        frame: ARFrame
    ) -> (position: SIMD3<Float>, highConfidence: Bool)? {
        guard let depth = frame.sceneDepth else { return nil }
        let viewSize = arView.bounds.size
        guard viewSize.width > 0, viewSize.height > 0 else { return nil }
        let normalizedViewPoint = CGPoint(
            x: point.x / viewSize.width,
            y: point.y / viewSize.height
        )
        let imagePoint = normalizedViewPoint.applying(
            frame.displayTransform(for: .portrait, viewportSize: viewSize).inverted()
        )
        guard (0 ... 1).contains(imagePoint.x), (0 ... 1).contains(imagePoint.y) else {
            return nil
        }

        let depthMap = depth.depthMap
        let depthWidth = CVPixelBufferGetWidth(depthMap)
        let depthHeight = CVPixelBufferGetHeight(depthMap)
        let centerX = min(depthWidth - 1, max(0, Int(imagePoint.x * CGFloat(depthWidth))))
        let centerY = min(depthHeight - 1, max(0, Int(imagePoint.y * CGFloat(depthHeight))))

        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }
        guard let depthBase = CVPixelBufferGetBaseAddress(depthMap) else { return nil }
        let depthStride = CVPixelBufferGetBytesPerRow(depthMap) / MemoryLayout<Float32>.size
        let depthValues = depthBase.assumingMemoryBound(to: Float32.self)

        guard let confidenceMap = depth.confidenceMap else { return nil }
        CVPixelBufferLockBaseAddress(confidenceMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(confidenceMap, .readOnly) }
        guard let confidenceBase = CVPixelBufferGetBaseAddress(confidenceMap) else { return nil }
        let confidenceStride = CVPixelBufferGetBytesPerRow(confidenceMap)
        let confidenceValues = confidenceBase.assumingMemoryBound(to: UInt8.self)

        var samples: [(depth: Float, confidence: UInt8)] = []
        for offsetY in -2 ... 2 {
            for offsetX in -2 ... 2 {
                let x = min(depthWidth - 1, max(0, centerX + offsetX))
                let y = min(depthHeight - 1, max(0, centerY + offsetY))
                let value = depthValues[y * depthStride + x]
                let confidence = confidenceValues[y * confidenceStride + x]
                if value.isFinite, value > 0.08, value < 12, confidence >= 1 {
                    samples.append((value, confidence))
                }
            }
        }
        guard samples.count >= 4 else { return nil }
        samples.sort { $0.depth < $1.depth }
        let sample = samples[samples.count / 2]

        let imageWidth = Float(CVPixelBufferGetWidth(frame.capturedImage))
        let imageHeight = Float(CVPixelBufferGetHeight(frame.capturedImage))
        let pixelX = Float(imagePoint.x) * imageWidth
        let pixelY = Float(imagePoint.y) * imageHeight
        let intrinsics = frame.camera.intrinsics
        let fx = intrinsics.columns.0.x
        let fy = intrinsics.columns.1.y
        let cx = intrinsics.columns.2.x
        let cy = intrinsics.columns.2.y
        guard fx > 0, fy > 0 else { return nil }

        let cameraPoint = SIMD4<Float>(
            (pixelX - cx) / fx * sample.depth,
            -(pixelY - cy) / fy * sample.depth,
            -sample.depth,
            1
        )
        let world = frame.camera.transform * cameraPoint
        return (
            SIMD3<Float>(world.x, world.y, world.z),
            sample.confidence >= 2
        )
    }

    private func showPreview(at position: SIMD3<Float>) {
        if let previewAnchor {
            arView.scene.removeAnchor(previewAnchor)
        }
        let anchor = AnchorEntity(world: position)
        let marker = ModelEntity(
            mesh: .generateSphere(radius: 0.035),
            materials: [SimpleMaterial(color: .systemOrange, roughness: 0.35, isMetallic: false)]
        )
        marker.position.y = 0.06
        anchor.addChild(marker)
        arView.scene.addAnchor(anchor)
        previewAnchor = anchor
    }

    private static func jpegData(from frame: ARFrame) throws -> Data {
        let image = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let cgImage = context.createCGImage(image, from: image.extent),
              let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.88)
        else {
            throw SpatialCaptureError.imageUnavailable
        }
        return data
    }
}

struct ItemPlacementControllerView: UIViewControllerRepresentable {
    let worldMapData: Data
    let roomScan: SpatialRoomScanSummary
    let roomCandidates: [SpatialRoomDetectionCandidate]
    let captureRequest: Int
    let manualRoomScanID: UUID?
    let manualRoomRequest: Int
    let onTracking: (String, Bool) -> Void
    let onRoomChanged: (SpatialRoomScanSummary?) -> Void
    let onCaptured: (Result<(SpatialPlacementDraft, Data), Error>) -> Void

    func makeUIViewController(context: Context) -> ItemPlacementController {
        let controller = ItemPlacementController(
            worldMapData: worldMapData,
            roomScan: roomScan,
            roomCandidates: roomCandidates
        )
        controller.onTracking = onTracking
        controller.onRoomChanged = onRoomChanged
        controller.onCaptured = onCaptured
        return controller
    }

    func updateUIViewController(
        _ uiViewController: ItemPlacementController,
        context: Context
    ) {
        uiViewController.onTracking = onTracking
        uiViewController.onRoomChanged = onRoomChanged
        uiViewController.onCaptured = onCaptured
        uiViewController.selectRoomManually(
            scanID: manualRoomScanID,
            request: manualRoomRequest
        )
        uiViewController.requestCapture(captureRequest)
    }

    static func dismantleUIViewController(
        _ uiViewController: ItemPlacementController,
        coordinator: Void
    ) {
        uiViewController.onTracking = nil
        uiViewController.onRoomChanged = nil
        uiViewController.onCaptured = nil
        uiViewController.stop()
    }
}

private extension simd_float4x4 {
    var translation: SIMD3<Float> {
        SIMD3<Float>(columns.3.x, columns.3.y, columns.3.z)
    }
}

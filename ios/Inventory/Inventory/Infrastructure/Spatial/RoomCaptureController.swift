import ARKit
import CoreImage
import RoomPlan
import SwiftUI
import UIKit
import simd

@MainActor
final class RoomCaptureController: UIViewController, @preconcurrency RoomCaptureViewDelegate {
    var onHint: ((String) -> Void)?
    var onProcessing: (() -> Void)?
    var onResult: ((Result<SpatialRoomScanDraft, Error>) -> Void)?

    private let arSession = ARSession()
    private var captureView: RoomCaptureView!
    private var lastFinishRequest = 0
    private var finishing = false
    private var guideImageURL: URL?
    private var workingDirectory: URL?
    private var isVisible = false
    private var captureRunning = false
    private var processingGeneration = UUID()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        captureView = RoomCaptureView(frame: view.bounds, arSession: arSession)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        captureView.isModelEnabled = true
        view.addSubview(captureView)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        isVisible = true
        startCaptureIfNeeded()
    }

    private func startCaptureIfNeeded() {
        guard isVisible, !finishing, !captureRunning else { return }
        var configuration = RoomCaptureSession.Configuration()
        configuration.isCoachingEnabled = true
        captureView.captureSession.run(configuration: configuration)
        captureRunning = true
        onHint?("Bewege das iPhone langsam entlang aller Wände und Möbel.")
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stop()
    }

    func stop() {
        guard isVisible || captureRunning || finishing else {
            arSession.pause()
            cleanupTemporaryFiles()
            return
        }
        let shouldStopCapture = captureRunning
        isVisible = false
        captureRunning = false
        finishing = false
        processingGeneration = UUID()
        if shouldStopCapture {
            captureView?.captureSession.stop(pauseARSession: true)
        } else {
            arSession.pause()
        }
        cleanupTemporaryFiles()
    }

    func requestFinish(_ request: Int) {
        guard request != lastFinishRequest else { return }
        lastFinishRequest = request
        guard isVisible, captureRunning, !finishing else { return }

        guard let frame = arSession.currentFrame else {
            onHint?("Die Raumortung startet noch. Bewege das iPhone kurz weiter.")
            return
        }
        guard frame.worldMappingStatus == .mapped else {
            onHint?("Für eine zuverlässige Wiedererkennung bitte noch weitere Raumseiten scannen.")
            return
        }

        finishing = true
        processingGeneration = UUID()
        guideImageURL = try? Self.writeGuideImage(from: frame)
        onProcessing?()
        captureRunning = false
        captureView.captureSession.stop(pauseARSession: false)
    }

    func captureView(
        shouldPresent roomDataForProcessing: CapturedRoomData,
        error: Error?
    ) -> Bool {
        guard isVisible, finishing else { return false }
        if let error {
            reportFailure(error)
            return false
        }
        return true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        guard isVisible, finishing else { return }
        if let error {
            reportFailure(error)
            return
        }

        let generation = processingGeneration
        let scanID = UUID()
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("inventory-room-scan-\(scanID.uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            workingDirectory = directory
            let modelURL = directory.appendingPathComponent("room.usdz")
            try processedResult.export(to: modelURL, exportOptions: .mesh)
            let scene = SpatialRoomScene.make(from: processedResult)

            arSession.getCurrentWorldMap { [weak self] worldMap, mapError in
                let archivedData: Data?
                if mapError == nil, let worldMap {
                    archivedData = try? NSKeyedArchiver.archivedData(
                        withRootObject: worldMap,
                        requiringSecureCoding: true
                    )
                } else {
                    archivedData = nil
                }
                Task { @MainActor [weak self, archivedData] in
                    guard let self else { return }
                    guard self.isCurrentProcessing(generation) else {
                        try? FileManager.default.removeItem(at: directory)
                        return
                    }
                    do {
                        guard let archivedData else {
                            throw SpatialCaptureError.worldMapUnavailable
                        }
                        let worldMapURL = directory.appendingPathComponent("room.arworldmap")
                        try archivedData.write(to: worldMapURL, options: .atomic)

                        var finalGuideURL: URL?
                        if let guideImageURL = self.guideImageURL,
                           FileManager.default.fileExists(atPath: guideImageURL.path) {
                            finalGuideURL = directory.appendingPathComponent("guide.jpg")
                            try FileManager.default.copyItem(
                                at: guideImageURL,
                                to: finalGuideURL!
                            )
                            try? FileManager.default.removeItem(at: guideImageURL)
                            self.guideImageURL = nil
                        }

                        self.arSession.pause()
                        self.finishing = false
                        self.processingGeneration = UUID()
                        self.workingDirectory = nil
                        self.onResult?(
                            .success(
                                SpatialRoomScanDraft(
                                    id: scanID,
                                    scene: scene,
                                    capturedAt: Date(),
                                    deviceModel: Self.hardwareModel,
                                    worldMapURL: worldMapURL,
                                    modelURL: modelURL,
                                    guideImageURL: finalGuideURL
                                )
                            )
                        )
                    } catch {
                        self.reportFailure(error)
                    }
                }
            }
        } catch {
            reportFailure(error)
        }
    }

    private func reportFailure(_ error: Error) {
        guard isVisible, finishing else { return }
        finishing = false
        processingGeneration = UUID()
        cleanupTemporaryFiles()
        startCaptureIfNeeded()
        onResult?(.failure(error))
    }

    private func isCurrentProcessing(_ generation: UUID) -> Bool {
        isVisible && finishing && processingGeneration == generation
    }

    private func cleanupTemporaryFiles() {
        if let workingDirectory {
            try? FileManager.default.removeItem(at: workingDirectory)
            self.workingDirectory = nil
        }
        if let guideImageURL {
            try? FileManager.default.removeItem(at: guideImageURL)
            self.guideImageURL = nil
        }
    }

    private static func writeGuideImage(from frame: ARFrame) throws -> URL {
        let image = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let cgImage = context.createCGImage(image, from: image.extent),
              let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.8)
        else {
            throw SpatialCaptureError.imageUnavailable
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("room-guide-\(UUID().uuidString)")
            .appendingPathExtension("jpg")
        try data.write(to: url, options: .atomic)
        return url
    }

    private static var hardwareModel: String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let mirror = Mirror(reflecting: systemInfo.machine)
        return mirror.children.reduce(into: "") { value, element in
            guard let byte = element.value as? Int8, byte != 0 else { return }
            value.append(Character(UnicodeScalar(UInt8(byte))))
        }
    }
}

struct RoomCaptureControllerView: UIViewControllerRepresentable {
    let finishRequest: Int
    let onHint: (String) -> Void
    let onProcessing: () -> Void
    let onResult: (Result<SpatialRoomScanDraft, Error>) -> Void

    func makeUIViewController(context: Context) -> RoomCaptureController {
        let controller = RoomCaptureController()
        controller.onHint = onHint
        controller.onProcessing = onProcessing
        controller.onResult = onResult
        return controller
    }

    func updateUIViewController(
        _ uiViewController: RoomCaptureController,
        context: Context
    ) {
        uiViewController.onHint = onHint
        uiViewController.onProcessing = onProcessing
        uiViewController.onResult = onResult
        uiViewController.requestFinish(finishRequest)
    }

    static func dismantleUIViewController(
        _ uiViewController: RoomCaptureController,
        coordinator: Void
    ) {
        uiViewController.onHint = nil
        uiViewController.onProcessing = nil
        uiViewController.onResult = nil
        uiViewController.stop()
    }
}

enum SpatialCaptureError: Error, LocalizedError {
    case worldMapUnavailable
    case imageUnavailable
    case relocalizationFailed
    case sessionFailed(String)
    case placementUnavailable

    var requiresRoomReselection: Bool {
        switch self {
        case .worldMapUnavailable, .relocalizationFailed, .sessionFailed:
            true
        case .imageUnavailable, .placementUnavailable:
            false
        }
    }

    var errorDescription: String? {
        switch self {
        case .worldMapUnavailable:
            "Die AR-Weltkarte konnte nicht gespeichert werden. Scanne den Raum erneut."
        case .imageUnavailable:
            "Das Kamerabild konnte nicht gespeichert werden."
        case .relocalizationFailed:
            "Der gespeicherte Raum wurde noch nicht zuverlässig erkannt."
        case .sessionFailed(let message):
            "Die AR-Raumortung ist fehlgeschlagen: \(message)"
        case .placementUnavailable:
            "Am Fadenkreuz wurde keine geeignete Oberfläche gefunden."
        }
    }
}

private extension SpatialRoomScene {
    static func make(from room: CapturedRoom) -> SpatialRoomScene {
        let allSurfaces = room.walls + room.doors + room.windows + room.openings + room.floors
        let surfaces = allSurfaces.map { surface in
            SpatialRoomSurface(
                id: surface.identifier,
                category: categoryName(surface.category),
                dimensions: vector(surface.dimensions),
                transform: matrix(surface.transform),
                confidence: confidenceName(surface.confidence)
            )
        }
        let objects = room.objects.map { object in
            SpatialRoomObject(
                id: object.identifier,
                category: categoryName(object.category),
                dimensions: vector(object.dimensions),
                transform: matrix(object.transform),
                confidence: confidenceName(object.confidence)
            )
        }

        var minimum = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var maximum = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        for surface in allSurfaces {
            includeBounds(
                dimensions: surface.dimensions,
                transform: surface.transform,
                minimum: &minimum,
                maximum: &maximum
            )
        }
        for object in room.objects {
            includeBounds(
                dimensions: object.dimensions,
                transform: object.transform,
                minimum: &minimum,
                maximum: &maximum
            )
        }
        if !minimum.x.isFinite || !maximum.x.isFinite {
            minimum = SIMD3<Float>(-1, 0, -1)
            maximum = SIMD3<Float>(1, 2, 1)
        }

        return SpatialRoomScene(
            bounds: SpatialRoomBounds(min: vector(minimum), max: vector(maximum)),
            surfaces: surfaces,
            objects: objects
        )
    }

    static func vector(_ value: SIMD3<Float>) -> SpatialVector3 {
        [Double(value.x), Double(value.y), Double(value.z)]
    }

    static func matrix(_ value: simd_float4x4) -> SpatialMatrix4 {
        [
            Double(value.columns.0.x), Double(value.columns.0.y),
            Double(value.columns.0.z), Double(value.columns.0.w),
            Double(value.columns.1.x), Double(value.columns.1.y),
            Double(value.columns.1.z), Double(value.columns.1.w),
            Double(value.columns.2.x), Double(value.columns.2.y),
            Double(value.columns.2.z), Double(value.columns.2.w),
            Double(value.columns.3.x), Double(value.columns.3.y),
            Double(value.columns.3.z), Double(value.columns.3.w),
        ]
    }

    static func confidenceName(_ confidence: CapturedRoom.Confidence) -> String {
        switch confidence {
        case .low: "low"
        case .medium: "medium"
        case .high: "high"
        @unknown default: "unknown"
        }
    }

    static func categoryName(_ category: CapturedRoom.Surface.Category) -> String {
        switch category {
        case .wall: "wall"
        case .opening: "opening"
        case .window: "window"
        case .door: "door"
        case .floor: "floor"
        @unknown default: "unknown"
        }
    }

    static func categoryName(_ category: CapturedRoom.Object.Category) -> String {
        switch category {
        case .storage: "storage"
        case .refrigerator: "refrigerator"
        case .stove: "stove"
        case .bed: "bed"
        case .sink: "sink"
        case .washerDryer: "washer-dryer"
        case .toilet: "toilet"
        case .bathtub: "bathtub"
        case .oven: "oven"
        case .dishwasher: "dishwasher"
        case .table: "table"
        case .sofa: "sofa"
        case .chair: "chair"
        case .fireplace: "fireplace"
        case .television: "television"
        case .stairs: "stairs"
        @unknown default: "unknown"
        }
    }

    static func includeBounds(
        dimensions: SIMD3<Float>,
        transform: simd_float4x4,
        minimum: inout SIMD3<Float>,
        maximum: inout SIMD3<Float>
    ) {
        let half = SIMD3<Float>(
            max(dimensions.x, 0.03) / 2,
            max(dimensions.y, 0.03) / 2,
            max(dimensions.z, 0.03) / 2
        )
        for x in [-half.x, half.x] {
            for y in [-half.y, half.y] {
                for z in [-half.z, half.z] {
                    let world = transform * SIMD4<Float>(x, y, z, 1)
                    let point = SIMD3<Float>(world.x, world.y, world.z)
                    minimum = simd.min(minimum, point)
                    maximum = simd.max(maximum, point)
                }
            }
        }
    }
}

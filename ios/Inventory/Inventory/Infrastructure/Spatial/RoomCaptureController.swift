import ARKit
import CoreImage
import RoomPlan
import SwiftUI
import UIKit
import simd

struct SpatialRoomCaptureBatch: Equatable, Sendable {
    let structureID: UUID
    let structureName: String
    let floorIdentifier: String
    let floorIndex: Int
    let coordinateSpaceID: UUID
    let georeferenceObservation: SpatialGeoreferenceObservation?
}

struct RoomCaptureFinishCommand: Equatable, Sendable {
    let sequence: Int
    let finalizesStructure: Bool

    static let idle = RoomCaptureFinishCommand(sequence: 0, finalizesStructure: false)
}

@MainActor
final class RoomCaptureController: UIViewController, @preconcurrency RoomCaptureViewDelegate {
    var onHint: ((String) -> Void)?
    var onProcessing: (() -> Void)?
    var onRoomCaptured: ((Int) -> Void)?
    var onResult: ((Result<[SpatialRoomScanDraft], Error>) -> Void)?

    private let arSession = ARSession()
    private var captureView: RoomCaptureView!
    private var lastFinishRequest = 0
    private var lastResumeRequest = 0
    private var finishing = false
    private var finalizingBatch = false
    private var pendingRoomName = ""
    private var currentRoomName = ""
    private var batch: SpatialRoomCaptureBatch?
    private var frozenGeoreference: SpatialStructureGeoreference?
    private var records: [CapturedRoomRecord] = []
    private var workingDirectories: [URL] = []
    private var isVisible = false
    private var captureRunning = false
    private var processingGeneration = UUID()
    private var georeferenceCaptureTask: Task<Void, Never>?

    private struct CapturedRoomRecord {
        let room: CapturedRoom
        let name: String
        let capturedAt: Date
        let guideImageURL: URL?
    }

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
        scheduleGeoreferenceCapture()
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
        finalizingBatch = false
        processingGeneration = UUID()
        georeferenceCaptureTask?.cancel()
        georeferenceCaptureTask = nil
        if shouldStopCapture {
            captureView?.captureSession.stop(pauseARSession: true)
        } else {
            arSession.pause()
        }
        cleanupTemporaryFiles()
    }

    func update(
        currentRoomName: String,
        batch: SpatialRoomCaptureBatch
    ) {
        self.currentRoomName = currentRoomName
        self.batch = batch
        captureGeoreferenceIfPossible()
        scheduleGeoreferenceCapture()
    }

    func requestResume(_ request: Int) {
        guard request != lastResumeRequest else { return }
        lastResumeRequest = request
        guard isVisible, !captureRunning, !finishing, !finalizingBatch else { return }
        startCaptureIfNeeded()
    }

    func requestFinish(_ command: RoomCaptureFinishCommand) {
        guard command.sequence != lastFinishRequest else { return }
        lastFinishRequest = command.sequence
        guard isVisible, captureRunning, !finishing else { return }

        let normalizedName = currentRoomName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedName.isEmpty else {
            onHint?("Gib diesem Raum zuerst einen Namen.")
            return
        }

        guard let frame = arSession.currentFrame else {
            onHint?("Die Raumortung startet noch. Bewege das iPhone kurz weiter.")
            return
        }
        guard frame.worldMappingStatus == .mapped else {
            onHint?("Für eine zuverlässige Wiedererkennung bitte noch weitere Raumseiten scannen.")
            return
        }

        finishing = true
        finalizingBatch = command.finalizesStructure
        pendingRoomName = String(normalizedName.prefix(240))
        processingGeneration = UUID()
        let guideImageURL = try? Self.writeGuideImage(from: frame)
        pendingGuideImageURL = guideImageURL
        captureGeoreferenceIfPossible(frame: frame)
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

        records.append(
            CapturedRoomRecord(
                room: processedResult,
                name: pendingRoomName,
                capturedAt: Date(),
                guideImageURL: pendingGuideImageURL
            )
        )
        pendingGuideImageURL = nil
        captureRunning = false

        if finalizingBatch {
            let generation = processingGeneration
            Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    let drafts = try await self.makeBatchDrafts()
                    guard self.isCurrentProcessing(generation) else {
                        drafts.forEach { $0.removeLocalArtifacts() }
                        return
                    }
                    self.arSession.pause()
                    self.finishing = false
                    self.finalizingBatch = false
                    self.processingGeneration = UUID()
                    self.records.removeAll()
                    self.workingDirectories.removeAll()
                    self.onResult?(.success(drafts))
                } catch {
                    self.reportFailure(error)
                }
            }
        } else {
            finishing = false
            processingGeneration = UUID()
            onRoomCaptured?(records.count)
        }
    }

    private var pendingGuideImageURL: URL?

    private func makeBatchDrafts() async throws -> [SpatialRoomScanDraft] {
        guard let batch, !records.isEmpty else {
            throw SpatialCaptureError.structureUnavailable
        }
        let worldMapData = try await currentWorldMapData()

        let structure: CapturedStructure?
        if records.count > 1 {
            // StructureBuilder is also RoomPlan's compatibility check for the
            // captured rooms. Never group the drafts under one coordinateSpaceId
            // when it rejects their relative locations.
            structure = try await StructureBuilder(options: [.beautifyObjects])
                .capturedStructure(from: records.map(\.room))
        } else {
            structure = nil
        }

        let structureSourceURL: URL?
        if let structure {
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent(
                    "inventory-structure-build-\(UUID().uuidString)",
                    isDirectory: true
                )
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            workingDirectories.append(directory)
            let url = directory.appendingPathComponent("structure.usdz")
            try structure.export(to: url, exportOptions: .mesh)
            structureSourceURL = url
        } else {
            structureSourceURL = nil
        }

        let normalizedRooms = structure?.rooms ?? records.map(\.room)
        var drafts: [SpatialRoomScanDraft] = []
        do {
            for (index, record) in records.enumerated() {
                let indexedRoom = normalizedRooms.indices.contains(index)
                    ? normalizedRooms[index]
                    : nil
                let room = normalizedRooms.first { $0.identifier == record.room.identifier }
                    ?? indexedRoom
                    ?? record.room
                let scanID = UUID()
                let directory = FileManager.default.temporaryDirectory
                    .appendingPathComponent(
                        "inventory-room-scan-\(scanID.uuidString)",
                        isDirectory: true
                    )
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                workingDirectories.append(directory)

                let modelURL = directory.appendingPathComponent("room.usdz")
                try room.export(to: modelURL, exportOptions: .mesh)
                let worldMapURL = directory.appendingPathComponent("room.arworldmap")
                try worldMapData.write(to: worldMapURL, options: .atomic)

                var guideURL: URL?
                if let source = record.guideImageURL,
                   FileManager.default.fileExists(atPath: source.path) {
                    let destination = directory.appendingPathComponent("guide.jpg")
                    try FileManager.default.copyItem(at: source, to: destination)
                    guideURL = destination
                }

                var structureModelURL: URL?
                if index == 0, let structureSourceURL {
                    let destination = directory.appendingPathComponent("structure.usdz")
                    try FileManager.default.copyItem(at: structureSourceURL, to: destination)
                    structureModelURL = destination
                }

                drafts.append(
                    SpatialRoomScanDraft(
                        id: scanID,
                        roomName: record.name,
                        scene: SpatialRoomScene.make(from: room),
                        capturedAt: record.capturedAt,
                        deviceModel: Self.hardwareModel,
                        worldMapURL: worldMapURL,
                        modelURL: modelURL,
                        guideImageURL: guideURL,
                        structureID: batch.structureID,
                        structureName: batch.structureName,
                        floorIdentifier: batch.floorIdentifier,
                        floorIndex: batch.floorIndex,
                        roomIdentifier: room.identifier.uuidString.lowercased(),
                        coordinateSpaceID: batch.coordinateSpaceID,
                        georeference: frozenGeoreference,
                        structureModelURL: structureModelURL
                    )
                )
            }
        } catch {
            drafts.forEach { $0.removeLocalArtifacts() }
            throw error
        }
        records.compactMap(\.guideImageURL).forEach { try? FileManager.default.removeItem(at: $0) }
        if let structureSourceURL {
            try? FileManager.default.removeItem(at: structureSourceURL.deletingLastPathComponent())
            workingDirectories.removeAll {
                $0 == structureSourceURL.deletingLastPathComponent()
            }
        }
        return drafts
    }

    private func currentWorldMapData() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            arSession.getCurrentWorldMap { worldMap, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let worldMap {
                    do {
                        let data = try NSKeyedArchiver.archivedData(
                            withRootObject: worldMap,
                            requiringSecureCoding: true
                        )
                        continuation.resume(returning: data)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                } else {
                    continuation.resume(throwing: SpatialCaptureError.worldMapUnavailable)
                }
            }
        }
    }

    private func captureGeoreferenceIfPossible(frame: ARFrame? = nil) {
        guard frozenGeoreference == nil,
              let observation = batch?.georeferenceObservation,
              abs(observation.capturedAt.timeIntervalSinceNow) <= 2.5,
              let frame = frame ?? arSession.currentFrame
        else { return }

        let cameraTransform = frame.camera.transform
        let forward = SIMD3<Float>(
            -cameraTransform.columns.2.x,
            0,
            -cameraTransform.columns.2.z
        )
        guard simd_length_squared(forward) > 0.01 else { return }
        let localCameraBearing = atan2(Double(forward.x), Double(-forward.z)) * 180 / .pi
        let localNegativeZBearing = Self.normalizedHeading(
            observation.trueHeading - localCameraBearing
        )
        let translation = cameraTransform.columns.3
        frozenGeoreference = SpatialStructureGeoreference(
            latitude: observation.latitude,
            longitude: observation.longitude,
            altitude: observation.altitude,
            headingDegrees: localNegativeZBearing,
            horizontalAccuracy: observation.horizontalAccuracy,
            verticalAccuracy: observation.verticalAccuracy,
            capturedAt: observation.capturedAt,
            source: .gps,
            localReferencePosition: [
                Double(translation.x),
                Double(translation.y),
                Double(translation.z),
            ],
            referencePoints: nil,
            entryMarkerCode: observation.entryMarkerCode
        )
    }

    /// RoomPlan starts its shared ARSession asynchronously. Poll briefly for
    /// the first camera frame so the already paired GPS/heading observation is
    /// anchored deterministically instead of depending on view-update timing.
    private func scheduleGeoreferenceCapture() {
        guard isVisible,
              captureRunning,
              frozenGeoreference == nil,
              batch?.georeferenceObservation != nil
        else { return }

        georeferenceCaptureTask?.cancel()
        georeferenceCaptureTask = Task { @MainActor [weak self] in
            for _ in 0 ..< 25 {
                guard let self,
                      !Task.isCancelled,
                      self.isVisible,
                      self.captureRunning,
                      self.frozenGeoreference == nil
                else { return }
                self.captureGeoreferenceIfPossible()
                if self.frozenGeoreference != nil { return }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
    }

    private static func normalizedHeading(_ degrees: Double) -> Double {
        let remainder = degrees.truncatingRemainder(dividingBy: 360)
        return remainder >= 0 ? remainder : remainder + 360
    }

    private func reportFailure(_ error: Error) {
        guard isVisible, finishing else { return }
        finishing = false
        finalizingBatch = false
        processingGeneration = UUID()
        cleanupTemporaryFiles()
        onResult?(.failure(error))
    }

    private func isCurrentProcessing(_ generation: UUID) -> Bool {
        isVisible && finishing && processingGeneration == generation
    }

    private func cleanupTemporaryFiles() {
        records.compactMap(\.guideImageURL).forEach { try? FileManager.default.removeItem(at: $0) }
        records.removeAll()
        if let pendingGuideImageURL {
            try? FileManager.default.removeItem(at: pendingGuideImageURL)
            self.pendingGuideImageURL = nil
        }
        workingDirectories.forEach { try? FileManager.default.removeItem(at: $0) }
        workingDirectories.removeAll()
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
    let finishCommand: RoomCaptureFinishCommand
    let resumeRequest: Int
    let currentRoomName: String
    let batch: SpatialRoomCaptureBatch
    let onHint: (String) -> Void
    let onProcessing: () -> Void
    let onRoomCaptured: (Int) -> Void
    let onResult: (Result<[SpatialRoomScanDraft], Error>) -> Void

    func makeUIViewController(context: Context) -> RoomCaptureController {
        let controller = RoomCaptureController()
        controller.onHint = onHint
        controller.onProcessing = onProcessing
        controller.onRoomCaptured = onRoomCaptured
        controller.onResult = onResult
        return controller
    }

    func updateUIViewController(
        _ uiViewController: RoomCaptureController,
        context: Context
    ) {
        uiViewController.onHint = onHint
        uiViewController.onProcessing = onProcessing
        uiViewController.onRoomCaptured = onRoomCaptured
        uiViewController.onResult = onResult
        uiViewController.update(currentRoomName: currentRoomName, batch: batch)
        uiViewController.requestResume(resumeRequest)
        uiViewController.requestFinish(finishCommand)
    }

    static func dismantleUIViewController(
        _ uiViewController: RoomCaptureController,
        coordinator: Void
    ) {
        uiViewController.onHint = nil
        uiViewController.onProcessing = nil
        uiViewController.onRoomCaptured = nil
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
    case structureUnavailable

    var requiresRoomReselection: Bool {
        switch self {
        case .worldMapUnavailable, .relocalizationFailed, .sessionFailed:
            true
        case .imageUnavailable, .placementUnavailable, .structureUnavailable:
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
        case .structureUnavailable:
            "Es wurde noch kein Raum für die Gebäudestruktur erfasst."
        }
    }
}

extension SpatialRoomScene {
    static func normalizedPolygonCorners(
        _ corners: [SIMD3<Float>]
    ) -> [SpatialVector3]? {
        guard (3 ... 1_024).contains(corners.count) else { return nil }
        return corners.map { corner in
            [Double(corner.x), Double(corner.y), Double(corner.z)]
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
                polygonCorners: normalizedPolygonCorners(surface.polygonCorners),
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

import Foundation
import ImageIO
import Vision
import simd

enum SpatialCameraCalibration {
    static func scaledIntrinsics(
        _ intrinsics: [Double],
        fromWidth: Int,
        fromHeight: Int,
        toWidth: Int,
        toHeight: Int
    ) -> [Double]? {
        guard intrinsics.count == 9,
              intrinsics.allSatisfy(\.isFinite),
              fromWidth > 0,
              fromHeight > 0,
              toWidth > 0,
              toHeight > 0
        else { return nil }
        let xScale = Double(toWidth) / Double(fromWidth)
        let yScale = Double(toHeight) / Double(fromHeight)
        var result = intrinsics
        for column in 0 ..< 3 {
            result[column * 3] *= xScale
            result[column * 3 + 1] *= yScale
        }
        return result
    }
}

struct SpatialKeyframeCapturePolicy: Equatable, Sendable {
    static let standard = SpatialKeyframeCapturePolicy()

    let maximumFrameCount: Int
    let maximumTotalBytes: Int
    let minimumInterval: TimeInterval
    let maximumInterval: TimeInterval
    let minimumTranslation: Double
    let minimumRotationDegrees: Double
    let minimumSharpness: Double

    init(
        maximumFrameCount: Int = 32,
        maximumTotalBytes: Int = 24 * 1_024 * 1_024,
        minimumInterval: TimeInterval = 1.25,
        maximumInterval: TimeInterval = 4,
        minimumTranslation: Double = 0.35,
        minimumRotationDegrees: Double = 18,
        minimumSharpness: Double = 0.018
    ) {
        self.maximumFrameCount = maximumFrameCount
        self.maximumTotalBytes = maximumTotalBytes
        self.minimumInterval = minimumInterval
        self.maximumInterval = maximumInterval
        self.minimumTranslation = minimumTranslation
        self.minimumRotationDegrees = minimumRotationDegrees
        self.minimumSharpness = minimumSharpness
    }

    func shouldCapture(
        timestamp: TimeInterval,
        cameraTransform: SpatialMatrix4,
        previous: SpatialRoomKeyframe?,
        frameCount: Int,
        totalBytes: Int
    ) -> Bool {
        guard frameCount < maximumFrameCount,
              totalBytes < maximumTotalBytes,
              cameraTransform.count == 16,
              cameraTransform.allSatisfy(\.isFinite)
        else { return false }
        guard let previous else { return true }

        let elapsed = timestamp - previous.timestamp
        guard elapsed >= minimumInterval else { return false }
        if elapsed >= maximumInterval { return true }
        return Self.translationDistance(cameraTransform, previous.cameraTransform)
            >= minimumTranslation ||
            Self.rotationDifferenceDegrees(cameraTransform, previous.cameraTransform)
            >= minimumRotationDegrees
    }

    static func translationDistance(
        _ first: SpatialMatrix4,
        _ second: SpatialMatrix4
    ) -> Double {
        guard first.count == 16, second.count == 16 else { return .infinity }
        return sqrt(
            pow(first[12] - second[12], 2) +
                pow(first[13] - second[13], 2) +
                pow(first[14] - second[14], 2)
        )
    }

    static func rotationDifferenceDegrees(
        _ first: SpatialMatrix4,
        _ second: SpatialMatrix4
    ) -> Double {
        guard let firstRotation = rotationMatrix(first),
              let secondRotation = rotationMatrix(second)
        else { return 180 }
        let relative = simd_transpose(firstRotation) * secondRotation
        let trace = Double(relative[0, 0] + relative[1, 1] + relative[2, 2])
        let cosine = max(-1, min(1, (trace - 1) / 2))
        return acos(cosine) * 180 / .pi
    }

    private static func rotationMatrix(_ values: SpatialMatrix4) -> simd_double3x3? {
        guard values.count == 16 else { return nil }
        let matrix = simd_double3x3(columns: (
            SIMD3(values[0], values[1], values[2]),
            SIMD3(values[4], values[5], values[6]),
            SIMD3(values[8], values[9], values[10])
        ))
        return matrix
    }
}

struct SpatialPhotoLocalization: Equatable, Sendable {
    let roomScanID: UUID
    let keyframeID: UUID
    let featureDistance: Double
    /// The stored keyframe pose is a coarse place estimate for a standalone
    /// photo. Live ARWorldMap relocalization remains the metric pose source.
    let estimatedCameraTransform: SpatialMatrix4
    let cameraPositionError: Double?
    let confidence: Double
}

enum SpatialPhotoLocalizationScorer {
    /// Vision feature-print distances are used as ranking evidence, while the
    /// already relocalized AR camera pose supplies the metric consistency check.
    /// This intentionally does not claim a new six-degree-of-freedom pose.
    static func confidence(
        bestDistance: Double,
        secondBestDistance: Double?,
        cameraPositionError: Double?
    ) -> Double {
        guard bestDistance.isFinite, bestDistance >= 0,
              cameraPositionError?.isFinite != false,
              (cameraPositionError ?? 0) >= 0
        else { return 0 }
        let appearance = max(0, min(1, 1 - bestDistance / 40))
        let separation: Double
        if let secondBestDistance,
           secondBestDistance.isFinite,
           secondBestDistance > 0 {
            separation = max(
                0,
                min(1, (secondBestDistance - bestDistance) / secondBestDistance * 3)
            )
        } else {
            separation = 0
        }
        if let cameraPositionError {
            let pose = max(0, min(1, 1 - cameraPositionError / 4))
            return appearance * 0.55 + separation * 0.2 + pose * 0.25
        }
        return appearance * 0.72 + separation * 0.28
    }
}

actor SpatialPhotoKeyframeMatcher {
    private struct IndexedReference {
        let roomScanID: UUID
        let metadata: SpatialRoomKeyframe
        let observation: VNFeaturePrintObservation
    }

    private var references: [IndexedReference] = []

    init() {}

    func add(_ reference: SpatialRoomKeyframeReference) {
        guard let observation = try? Self.featurePrint(
            for: reference.imageData,
            orientation: Self.visionOrientation(for: reference.metadata.orientation)
        ) else {
            return
        }
        references.append(
            IndexedReference(
                roomScanID: reference.roomScanID,
                metadata: reference.metadata,
                observation: observation
            )
        )
    }

    var isEmpty: Bool { references.isEmpty }

    func match(
        imageData: Data,
        currentCameraTransform: SpatialMatrix4? = nil,
        roomScanID: UUID? = nil
    ) -> SpatialPhotoLocalization? {
        // ItemPlacementController bakes its output upright before matching.
        guard let query = try? Self.featurePrint(
            for: imageData,
            orientation: .up
        ) else { return nil }
        let ranked = references.compactMap { indexed -> (IndexedReference, Double)? in
            guard roomScanID == nil || indexed.roomScanID == roomScanID else { return nil }
            var value: Float = 0
            guard (try? query.computeDistance(&value, to: indexed.observation)) != nil,
                  value.isFinite
            else { return nil }
            return (indexed, Double(value))
        }.sorted { $0.1 < $1.1 }
        guard let best = ranked.first else { return nil }

        let poseError = currentCameraTransform.map {
            SpatialKeyframeCapturePolicy.translationDistance(
                $0,
                best.0.metadata.cameraTransform
            )
        }
        return SpatialPhotoLocalization(
            roomScanID: best.0.roomScanID,
            keyframeID: best.0.metadata.id,
            featureDistance: best.1,
            estimatedCameraTransform: best.0.metadata.cameraTransform,
            cameraPositionError: poseError,
            confidence: SpatialPhotoLocalizationScorer.confidence(
                bestDistance: best.1,
                secondBestDistance: ranked.dropFirst().first?.1,
                cameraPositionError: poseError
            )
        )
    }

    nonisolated static func visionOrientation(for value: String) -> CGImagePropertyOrientation {
        switch value {
        case "up-mirrored": .upMirrored
        case "down": .down
        case "down-mirrored": .downMirrored
        case "left-mirrored": .leftMirrored
        case "right": .right
        case "right-mirrored": .rightMirrored
        case "left": .left
        default: .up
        }
    }

    private static func featurePrint(
        for data: Data,
        orientation: CGImagePropertyOrientation
    ) throws -> VNFeaturePrintObservation {
        let request = VNGenerateImageFeaturePrintRequest()
        let handler = VNImageRequestHandler(
            data: data,
            orientation: orientation,
            options: [:]
        )
        try handler.perform([request])
        guard let observation = request.results?.first as? VNFeaturePrintObservation else {
            throw SpatialCaptureError.imageUnavailable
        }
        return observation
    }
}

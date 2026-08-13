import Foundation
import ImageIO
import UniformTypeIdentifiers
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
    let candidateCount: Int
    let secondBestFeatureDistance: Double?
}

enum SpatialPhotoOnlyLocalizationState: Equatable, Sendable {
    case unavailable
    case indexing
    case ready(referenceCount: Int)
    case matching(referenceCount: Int)

    var referenceCount: Int {
        switch self {
        case .ready(let referenceCount), .matching(let referenceCount):
            referenceCount
        case .unavailable, .indexing:
            0
        }
    }

    var canMatch: Bool {
        if case .ready(let referenceCount) = self {
            return referenceCount >= SpatialPhotoOnlyLocalizationPolicy.minimumCandidateCount
        }
        return false
    }

    mutating func beginIndexing() {
        self = .indexing
    }

    mutating func finishIndexing(referenceCount: Int) {
        self = referenceCount >= SpatialPhotoOnlyLocalizationPolicy.minimumCandidateCount
            ? .ready(referenceCount: referenceCount)
            : .unavailable
    }

    mutating func beginMatching() -> Bool {
        guard case .ready(let referenceCount) = self,
              referenceCount >= SpatialPhotoOnlyLocalizationPolicy.minimumCandidateCount
        else { return false }
        self = .matching(referenceCount: referenceCount)
        return true
    }

    mutating func finishMatching() {
        guard case .matching(let referenceCount) = self else { return }
        self = .ready(referenceCount: referenceCount)
    }
}

struct SpatialPhotoOnlyEstimate: Equatable, Sendable, Identifiable {
    var id: UUID { keyframeID }

    let roomScanID: UUID
    let keyframeID: UUID
    let featureDistance: Double
    let confidence: Double
    /// This is the pose of the matched stored keyframe, not a solved pose for
    /// the query image and never an object position.
    let referenceCameraTransform: SpatialMatrix4

    var referenceCameraPosition: SpatialVector3 {
        [
            referenceCameraTransform[12],
            referenceCameraTransform[13],
            referenceCameraTransform[14],
        ]
    }
}

enum SpatialPhotoOnlyLocalizationPolicy {
    static let maximumQueryBytes = SpatialKeyframeCapturePolicy.standard.maximumTotalBytes
    static let minimumCandidateCount = 2
    static let maximumFeatureDistance = 28.0
    static let minimumConfidence = 0.62

    static func estimate(
        from localization: SpatialPhotoLocalization
    ) -> SpatialPhotoOnlyEstimate? {
        let transform = localization.estimatedCameraTransform
        guard let secondBestDistance = localization.secondBestFeatureDistance,
              localization.candidateCount >= minimumCandidateCount,
              localization.featureDistance.isFinite,
              localization.featureDistance >= 0,
              localization.featureDistance <= maximumFeatureDistance,
              secondBestDistance.isFinite,
              secondBestDistance > localization.featureDistance,
              (secondBestDistance - localization.featureDistance) /
                  secondBestDistance >= 0.12,
              localization.confidence.isFinite,
              localization.confidence >= minimumConfidence,
              localization.confidence <= 1,
              transform.count == 16,
              transform.allSatisfy(\.isFinite),
              abs(transform[3]) < 0.000_001,
              abs(transform[7]) < 0.000_001,
              abs(transform[11]) < 0.000_001,
              abs(transform[15] - 1) < 0.000_001
        else { return nil }

        return SpatialPhotoOnlyEstimate(
            roomScanID: localization.roomScanID,
            keyframeID: localization.keyframeID,
            featureDistance: localization.featureDistance,
            confidence: localization.confidence,
            referenceCameraTransform: transform
        )
    }
}

enum SpatialPhotoQueryError: Error, LocalizedError, Sendable {
    case encodedImageTooLarge
    case unreadableImage
    case unableToEncodeImage

    var errorDescription: String? {
        switch self {
        case .encodedImageTooLarge:
            "Das Foto ist für die lokale Zuordnung zu groß."
        case .unreadableImage:
            "Das ausgewählte Foto konnte nicht gelesen werden."
        case .unableToEncodeImage:
            "Das Foto konnte nicht für die Zuordnung vorbereitet werden."
        }
    }
}

enum SpatialPhotoQueryProcessor {
    static let maximumPixelSize = 2_200

    /// Applies the source orientation while decoding, bounds memory/transfer
    /// size, and emits an upright JPEG because the matcher consumes `.up`.
    static func normalizedJPEG(from encodedData: Data) throws -> Data {
        guard encodedData.count <= SpatialPhotoOnlyLocalizationPolicy.maximumQueryBytes else {
            throw SpatialPhotoQueryError.encodedImageTooLarge
        }
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(
            encodedData as CFData,
            sourceOptions
        ) else {
            throw SpatialPhotoQueryError.unreadableImage
        }
        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(
            source,
            CGImageSourceGetPrimaryImageIndex(source),
            thumbnailOptions as CFDictionary
        ) else {
            throw SpatialPhotoQueryError.unreadableImage
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw SpatialPhotoQueryError.unableToEncodeImage
        }
        let properties: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: 0.86,
            kCGImagePropertyOrientation: 1,
        ]
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw SpatialPhotoQueryError.unableToEncodeImage
        }
        let result = output as Data
        guard result.count <= SpatialPhotoOnlyLocalizationPolicy.maximumQueryBytes else {
            throw SpatialPhotoQueryError.encodedImageTooLarge
        }
        return result
    }
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

    @discardableResult
    func add(_ reference: SpatialRoomKeyframeReference) -> Bool {
        guard let observation = try? Self.featurePrint(
            for: reference.imageData,
            orientation: Self.visionOrientation(for: reference.metadata.orientation)
        ) else {
            return false
        }
        references.append(
            IndexedReference(
                roomScanID: reference.roomScanID,
                metadata: reference.metadata,
                observation: observation
            )
        )
        return true
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
        let secondBestDistance = ranked.dropFirst().first?.1

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
                secondBestDistance: secondBestDistance,
                cameraPositionError: poseError
            ),
            candidateCount: ranked.count,
            secondBestFeatureDistance: secondBestDistance
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

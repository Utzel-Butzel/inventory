import XCTest
@testable import Inventory

final class SpatialKeyframeTests: XCTestCase {
    func testNativeRasterResizePreservesPinholeCalibration() throws {
        let scaled = try XCTUnwrap(
            SpatialCameraCalibration.scaledIntrinsics(
                [1_000, 0, 0, 0, 1_000, 0, 800, 600, 1],
                fromWidth: 1_600,
                fromHeight: 1_200,
                toWidth: 800,
                toHeight: 600
            )
        )

        XCTAssertEqual(scaled, [500, 0, 0, 0, 500, 0, 400, 300, 1])
        XCTAssertGreaterThan(scaled[0], 0)
        XCTAssertGreaterThan(scaled[4], 0)
        XCTAssertEqual(scaled[8], 1)
    }

    func testCapturePolicyRequiresTimeAndMotionAndRespectsBounds() {
        let policy = SpatialKeyframeCapturePolicy(
            maximumFrameCount: 2,
            maximumTotalBytes: 1_000,
            minimumInterval: 1.25,
            maximumInterval: 4,
            minimumTranslation: 0.35,
            minimumRotationDegrees: 18,
            minimumSharpness: 0.01
        )
        let previous = keyframe(timestamp: 10, transform: identity)

        XCTAssertFalse(
            policy.shouldCapture(
                timestamp: 10.5,
                cameraTransform: translated(x: 1),
                previous: previous,
                frameCount: 1,
                totalBytes: 100
            )
        )
        XCTAssertTrue(
            policy.shouldCapture(
                timestamp: 11.5,
                cameraTransform: translated(x: 0.4),
                previous: previous,
                frameCount: 1,
                totalBytes: 100
            )
        )
        XCTAssertTrue(
            policy.shouldCapture(
                timestamp: 11.5,
                cameraTransform: rotatedY(degrees: 20),
                previous: previous,
                frameCount: 1,
                totalBytes: 100
            )
        )
        XCTAssertTrue(
            policy.shouldCapture(
                timestamp: 14,
                cameraTransform: identity,
                previous: previous,
                frameCount: 1,
                totalBytes: 100
            )
        )
        XCTAssertFalse(
            policy.shouldCapture(
                timestamp: 14,
                cameraTransform: identity,
                previous: previous,
                frameCount: 2,
                totalBytes: 100
            )
        )
        XCTAssertFalse(
            policy.shouldCapture(
                timestamp: 14,
                cameraTransform: identity,
                previous: previous,
                frameCount: 1,
                totalBytes: 1_000
            )
        )
    }

    func testLocalizationConfidenceRewardsDistinctMatchAndPoseAgreement() {
        let strong = SpatialPhotoLocalizationScorer.confidence(
            bestDistance: 5,
            secondBestDistance: 18,
            cameraPositionError: 0.25
        )
        let ambiguous = SpatialPhotoLocalizationScorer.confidence(
            bestDistance: 5,
            secondBestDistance: 5.2,
            cameraPositionError: 0.25
        )
        let farAway = SpatialPhotoLocalizationScorer.confidence(
            bestDistance: 5,
            secondBestDistance: 18,
            cameraPositionError: 8
        )
        let standalone = SpatialPhotoLocalizationScorer.confidence(
            bestDistance: 5,
            secondBestDistance: 18,
            cameraPositionError: nil
        )

        XCTAssertGreaterThan(strong, ambiguous)
        XCTAssertGreaterThan(strong, farAway)
        XCTAssertTrue((0 ... 1).contains(strong))
        XCTAssertTrue((0 ... 1).contains(standalone))
    }

    func testKeyframeDecodesBackendReadContract() throws {
        let id = UUID()
        let json = """
        {
          "id":"\(id.uuidString.lowercased())",
          "capturedAt":"2026-08-13T10:00:00Z",
          "timestamp":42.5,
          "cameraTransform":[1,0,0,0,0,1,0,0,0,0,1,0,1,2,-3,1],
          "intrinsics":[1000,0,0,0,1000,0,800,600,1],
          "width":1600,
          "height":1200,
          "orientation":"right",
          "quality":0.83,
          "mimeType":"image/jpeg",
          "size":12345,
          "checksumSha256":"abc",
          "url":"/api/v1/room-scans/scan/keyframes/\(id.uuidString.lowercased())"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let keyframe = try decoder.decode(
            SpatialRoomKeyframe.self,
            from: Data(json.utf8)
        )

        XCTAssertEqual(keyframe.id, id)
        XCTAssertEqual(keyframe.width, 1600)
        XCTAssertEqual(keyframe.height, 1200)
        XCTAssertEqual(keyframe.orientation, "right")
        XCTAssertEqual(keyframe.quality, 0.83)
        XCTAssertEqual(keyframe.url, "/api/v1/room-scans/scan/keyframes/\(id.uuidString.lowercased())")
    }

    func testPlacementEvidenceUsesBackendFieldNames() throws {
        let keyframeID = UUID()
        let evidence = SpatialPlacementDraft.LocalizationEvidence(
            matchedKeyframeID: keyframeID,
            distance: 7.5,
            confidence: 0.78,
            cameraPositionError: 0.6
        )
        let data = try JSONEncoder().encode(evidence)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        XCTAssertEqual(
            (object["matchedKeyframeId"] as? String)?.lowercased(),
            keyframeID.uuidString.lowercased()
        )
        XCTAssertEqual(object["distance"] as? Double, 7.5)
        XCTAssertEqual(object["confidence"] as? Double, 0.78)
    }

    func testBackendOrientationMapsToVisionOrientation() {
        XCTAssertEqual(SpatialPhotoKeyframeMatcher.visionOrientation(for: "up"), .up)
        XCTAssertEqual(SpatialPhotoKeyframeMatcher.visionOrientation(for: "right"), .right)
        XCTAssertEqual(
            SpatialPhotoKeyframeMatcher.visionOrientation(for: "left-mirrored"),
            .leftMirrored
        )
        XCTAssertEqual(
            SpatialPhotoKeyframeMatcher.visionOrientation(for: "invalid"),
            .up
        )
    }

    private var identity: SpatialMatrix4 {
        SpatialRoomScene.identityMatrix
    }

    private func translated(x: Double) -> SpatialMatrix4 {
        var result = identity
        result[12] = x
        return result
    }

    private func rotatedY(degrees: Double) -> SpatialMatrix4 {
        let angle = degrees * .pi / 180
        let cosine = cos(angle)
        let sine = sin(angle)
        return [
            cosine, 0, -sine, 0,
            0, 1, 0, 0,
            sine, 0, cosine, 0,
            0, 0, 0, 1,
        ]
    }

    private func keyframe(
        timestamp: Double,
        transform: SpatialMatrix4
    ) -> SpatialRoomKeyframe {
        SpatialRoomKeyframe(
            id: UUID(),
            capturedAt: Date(),
            timestamp: timestamp,
            cameraTransform: transform,
            intrinsics: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            width: 1,
            height: 1,
            orientation: "right",
            quality: 1
        )
    }
}

import XCTest
@testable import Inventory

final class SpatialCaptureStateTests: XCTestCase {
    func testStartingAnotherRoomRejectsTheLatePreviousWorldMap() {
        let firstScanID = UUID()
        let secondScanID = UUID()
        var state = SpatialWorldMapSelectionState()

        let firstGeneration = state.begin(scanID: firstScanID)
        let secondGeneration = state.begin(scanID: secondScanID)

        XCTAssertFalse(state.accepts(scanID: firstScanID, generation: firstGeneration))
        XCTAssertTrue(state.accepts(scanID: secondScanID, generation: secondGeneration))
    }

    func testCancellingSelectionInvalidatesItsInFlightWorldMap() {
        let scanID = UUID()
        var state = SpatialWorldMapSelectionState()
        let generation = state.begin(scanID: scanID)

        state.cancel()

        XCTAssertFalse(state.accepts(scanID: scanID, generation: generation))
        XCTAssertNil(state.scanID)
    }

    func testRelocalizationTimeoutCannotFailAReadySession() {
        var gate = SpatialRelocalizationGate()

        gate.markReady()

        XCTAssertTrue(gate.isReady)
        XCTAssertFalse(gate.failIfSearching())
        XCTAssertEqual(gate.phase, .ready)
    }

    func testInterruptionRearmsRelocalizationFailurePath() {
        var gate = SpatialRelocalizationGate()
        gate.markReady()

        gate.beginSearching()

        XCTAssertTrue(gate.failIfSearching())
        XCTAssertTrue(gate.isFailed)
        XCTAssertFalse(gate.failIfSearching(), "A terminal failure must only be reported once")
    }

    func testOrientedFloorFootprintDoesNotUseBroadAxisAlignedBounds() {
        let angle = Double.pi / 4
        let cosine = cos(angle)
        let sine = sin(angle)
        let scene = makeScene(
            centerX: 0,
            width: 4,
            length: 2,
            transform: [
                cosine, 0, -sine, 0,
                0, 1, 0, 0,
                sine, 0, cosine, 0,
                0, 0, 0, 1,
            ],
            bounds: SpatialRoomBounds(min: [-3, 0, -3], max: [3, 3, 3])
        )
        let footprint = SpatialRoomFootprint(scene: scene)

        XCTAssertTrue(footprint.contains(position: [0, 1.5, 0]))
        XCTAssertFalse(
            footprint.contains(position: [2.5, 1.5, 2.5]),
            "A point inside only the scene AABB must not count as inside an oriented floor."
        )
    }

    func testFootprintAppliesModelToSharedWorldTransform() {
        let scene = makeScene(
            centerX: 0,
            width: 2,
            length: 2,
            worldFromModel: [
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                8, 0, -3, 1,
            ]
        )
        let footprint = SpatialRoomFootprint(scene: scene)

        XCTAssertTrue(footprint.contains(position: [8, 1.4, -3]))
        XCTAssertFalse(footprint.contains(position: [0, 1.4, 0]))
    }

    func testFootprintPreservesConcaveRoomPlanPolygon() {
        let scene = SpatialRoomScene(
            bounds: SpatialRoomBounds(min: [-2, 0, -2], max: [2, 3, 2]),
            surfaces: [
                SpatialRoomSurface(
                    id: UUID(),
                    category: "floor",
                    dimensions: [4, 4, 0],
                    transform: [
                        1, 0, 0, 0,
                        0, 0, 1, 0,
                        0, 1, 0, 0,
                        0, 0, 0, 1,
                    ],
                    polygonCorners: [
                        [-2, -2, 0], [2, -2, 0], [2, -1, 0],
                        [0, -1, 0], [0, 2, 0], [-2, 2, 0],
                    ],
                    confidence: "high"
                ),
            ],
            objects: []
        )
        let footprint = SpatialRoomFootprint(scene: scene)

        XCTAssertTrue(footprint.contains(position: [-1, 1.4, 1]))
        XCTAssertFalse(
            footprint.contains(position: [1, 1.4, 1]),
            "A point in the concave bounding-box cutout is outside the room."
        )
    }

    func testRoomPlanSceneOmitsEmptyAndPartialPolygons() {
        XCTAssertNil(SpatialRoomScene.normalizedPolygonCorners([]))
        XCTAssertNil(
            SpatialRoomScene.normalizedPolygonCorners([
                SIMD3<Float>(0, 0, 0),
                SIMD3<Float>(1, 0, 0),
            ])
        )
        XCTAssertEqual(
            SpatialRoomScene.normalizedPolygonCorners([
                SIMD3<Float>(0, 0, 0),
                SIMD3<Float>(1, 0, 0),
                SIMD3<Float>(0, 1, 0),
            ]),
            [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
        )
    }

    func testContainmentTrackerRequiresStableTransitionBetweenRooms() {
        let first = makeCandidate(
            name: "Werkstatt",
            scene: makeScene(centerX: 0, width: 2, length: 2)
        )
        let second = makeCandidate(
            name: "Lager",
            scene: makeScene(centerX: 3, width: 2, length: 2)
        )
        var tracker = SpatialRoomContainmentTracker(
            candidates: [first, second],
            confirmationFrames: 2,
            exitFrames: 2,
            currentRoomMargin: 0.2,
            entryMargin: 0.05
        )

        XCTAssertNil(tracker.update(position: [0, 1.4, 0]))
        XCTAssertEqual(tracker.update(position: [0, 1.4, 0]), first.scan.id)
        XCTAssertEqual(
            tracker.update(position: [3, 1.4, 0]),
            first.scan.id,
            "A single frame after crossing a doorway must not switch rooms."
        )
        XCTAssertEqual(tracker.update(position: [3, 1.4, 0]), second.scan.id)
    }

    private func makeCandidate(
        name: String,
        scene: SpatialRoomScene
    ) -> SpatialRoomDetectionCandidate {
        let now = Date()
        let scan = SpatialRoomScanSummary(
            id: UUID(),
            roomResourceID: UUID(),
            roomName: name,
            revision: 1,
            status: "active",
            capturedAt: now,
            deviceModel: "iPhone",
            createdAt: now,
            updatedAt: now,
            placementCount: 0,
            assets: [],
            keyframes: nil,
            structureID: UUID(),
            structureName: "Testgebäude",
            floorIdentifier: "EG",
            floorIndex: 0,
            roomIdentifier: UUID().uuidString.lowercased(),
            coordinateSpaceID: nil,
            georeference: nil
        )
        return SpatialRoomDetectionCandidate(scan: scan, scene: scene)
    }

    private func makeScene(
        centerX: Double,
        width: Double,
        length: Double,
        transform: SpatialMatrix4? = nil,
        bounds: SpatialRoomBounds? = nil,
        worldFromModel: SpatialMatrix4 = SpatialRoomScene.identityMatrix
    ) -> SpatialRoomScene {
        let floorTransform = transform ?? [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            centerX, 0, 0, 1,
        ]
        return SpatialRoomScene(
            worldFromModel: worldFromModel,
            bounds: bounds ?? SpatialRoomBounds(
                min: [centerX - width / 2, 0, -length / 2],
                max: [centerX + width / 2, 3, length / 2]
            ),
            surfaces: [
                SpatialRoomSurface(
                    id: UUID(),
                    category: "floor",
                    dimensions: [width, 0, length],
                    transform: floorTransform,
                    polygonCorners: nil,
                    confidence: "high"
                ),
            ],
            objects: []
        )
    }
}

import XCTest
@testable import Inventory

final class SpatialRoomLifecycleTests: XCTestCase {
    func testNewStructureModeUsesOnlyGeneratedIdentitiesAndNewResources() {
        let generatedStructureID = UUID()
        let generatedCoordinateSpaceID = UUID()
        let mode = SpatialRoomScanMode.newStructure

        let identity = SpatialRoomCaptureIdentity(
            mode: mode,
            generatedStructureID: generatedStructureID,
            generatedCoordinateSpaceID: generatedCoordinateSpaceID
        )

        XCTAssertEqual(identity.structureID, generatedStructureID)
        XCTAssertEqual(identity.coordinateSpaceID, generatedCoordinateSpaceID)
        XCTAssertTrue(mode.supportsMultipleRooms)
        XCTAssertNil(mode.existingRoomResourceID(forDraftAt: 0))
    }

    func testLibraryGroupsOneStructureIntoFloors() throws {
        let structureID = UUID()
        let groundCoordinateSpaceID = UUID()
        let upperCoordinateSpaceID = UUID()
        let scans = [
            makeScan(
                roomName: "Werkstatt",
                structureID: structureID,
                floorIdentifier: "EG",
                floorIndex: 0,
                coordinateSpaceID: groundCoordinateSpaceID
            ),
            makeScan(
                roomName: "Lager",
                structureID: structureID,
                floorIdentifier: "EG",
                floorIndex: 0,
                coordinateSpaceID: groundCoordinateSpaceID
            ),
            makeScan(
                roomName: "Büro",
                structureID: structureID,
                floorIdentifier: "1. OG",
                floorIndex: 1,
                coordinateSpaceID: upperCoordinateSpaceID
            ),
        ]

        let library = SpatialRoomScanLibrary(scans: scans)

        let structure = try XCTUnwrap(library.structures.first)
        XCTAssertEqual(library.structures.count, 1)
        XCTAssertEqual(structure.structureID, structureID)
        XCTAssertEqual(structure.structureName, "Rosenwerk")
        XCTAssertEqual(structure.roomCount, 3)
        XCTAssertEqual(structure.floors.map(\.title), ["EG", "1. OG"])
        XCTAssertEqual(
            structure.appendSeed?.existingCoordinateSpaceIDs,
            Set([groundCoordinateSpaceID, upperCoordinateSpaceID])
        )
        XCTAssertTrue(library.standaloneScans.isEmpty)
    }

    func testAppendModeReusesStructureButCreatesFreshCoordinateSpace() throws {
        let structureID = UUID()
        let previousCoordinateSpaceID = UUID()
        let freshCoordinateSpaceID = UUID()
        let seed = SpatialRoomAppendSeed(
            structureID: structureID,
            structureName: "Rosenwerk",
            suggestedFloorIdentifier: "EG",
            suggestedFloorIndex: 0,
            usesGeoreference: true,
            existingCoordinateSpaceIDs: [previousCoordinateSpaceID]
        )
        let mode = SpatialRoomScanMode.appendToStructure(seed)

        let identity = SpatialRoomCaptureIdentity(
            mode: mode,
            generatedStructureID: UUID(),
            generatedCoordinateSpaceID: freshCoordinateSpaceID
        )

        XCTAssertEqual(identity.structureID, structureID)
        XCTAssertEqual(identity.coordinateSpaceID, freshCoordinateSpaceID)
        XCTAssertNotEqual(identity.coordinateSpaceID, previousCoordinateSpaceID)
        XCTAssertTrue(mode.supportsMultipleRooms)
        XCTAssertNil(mode.existingRoomResourceID(forDraftAt: 0))
        XCTAssertNil(mode.existingRoomResourceID(forDraftAt: 1))

        let collisionSafeIdentity = SpatialRoomCaptureIdentity(
            mode: mode,
            generatedCoordinateSpaceID: previousCoordinateSpaceID
        )
        XCTAssertNotEqual(
            collisionSafeIdentity.coordinateSpaceID,
            previousCoordinateSpaceID,
            "Appending must never reuse an existing AR coordinate space."
        )
    }

    func testReplaceModeTargetsExactlyTheExistingRoomResource() {
        let scan = makeScan(
            roomName: "Werkstatt",
            structureID: UUID(),
            floorIdentifier: "EG",
            floorIndex: 0,
            coordinateSpaceID: UUID()
        )
        let mode = SpatialRoomScanMode.replaceRoom(scan)
        let identity = SpatialRoomCaptureIdentity(
            mode: mode,
            generatedCoordinateSpaceID: UUID()
        )

        XCTAssertFalse(mode.supportsMultipleRooms)
        XCTAssertEqual(mode.existingRoomResourceID(forDraftAt: 0), scan.roomResourceID)
        XCTAssertNil(mode.existingRoomResourceID(forDraftAt: 1))
        XCTAssertEqual(identity.structureID, scan.structureID)
        XCTAssertNotEqual(identity.coordinateSpaceID, scan.coordinateSpaceID)
    }

    func testUnstructuredRoomsStayOutsideStructureCards() {
        let standalone = makeScan(
            roomName: "Altbestand",
            structureID: nil,
            structureName: nil,
            floorIdentifier: nil,
            floorIndex: nil,
            coordinateSpaceID: nil
        )

        let library = SpatialRoomScanLibrary(scans: [standalone])

        XCTAssertTrue(library.structures.isEmpty)
        XCTAssertEqual(library.standaloneScans.map(\.id), [standalone.id])
    }

    private func makeScan(
        roomName: String,
        structureID: UUID?,
        structureName: String? = "Rosenwerk",
        floorIdentifier: String?,
        floorIndex: Int?,
        coordinateSpaceID: UUID?
    ) -> SpatialRoomScanSummary {
        let now = Date()
        return SpatialRoomScanSummary(
            id: UUID(),
            roomResourceID: UUID(),
            roomName: roomName,
            revision: 1,
            status: "active",
            capturedAt: now,
            deviceModel: "iPhone",
            createdAt: now,
            updatedAt: now,
            placementCount: 0,
            assets: [],
            structureID: structureID,
            structureName: structureName,
            floorIdentifier: floorIdentifier,
            floorIndex: floorIndex,
            roomIdentifier: UUID().uuidString.lowercased(),
            coordinateSpaceID: coordinateSpaceID,
            georeference: nil
        )
    }
}

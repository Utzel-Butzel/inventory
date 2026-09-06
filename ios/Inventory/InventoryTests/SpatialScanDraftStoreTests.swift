import XCTest
@testable import Inventory

final class SpatialScanDraftStoreTests: XCTestCase {
    func testPartialSingleRoomSurvivesRelaunchWithSameUploadIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let draft = try makeDraft(root: root)
        let pendingID = UUID()
        let resourceID = UUID()
        let store = try SpatialScanDraftStore(contextIdentifier: "server#org#user", root: root)
        var pending = SpatialPendingScan(
            id: pendingID, contextIdentifier: "server#org#user", mode: .newStructure, drafts: [draft],
            roomResourceIDs: [draft.id: resourceID], uploadedScanIDs: []
        )
        pending = try store.save(pending)
        draft.removeLocalArtifacts()

        let restoredStore = try SpatialScanDraftStore(contextIdentifier: "server#org#user", root: root)
        let restored = try XCTUnwrap(restoredStore.load().first)
        XCTAssertEqual(restored.id, pendingID)
        XCTAssertEqual(restored.drafts.first?.id, draft.id)
        XCTAssertEqual(restored.roomResourceIDs[draft.id], resourceID)
        XCTAssertNil(restored.drafts.first?.worldMapURL)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(restored.drafts.first?.modelURL)), Data([1, 2, 3]))

        let body = try MultipartFormFileBuilder.buildRoomScan(draft: restored.drafts[0], roomResourceID: resourceID)
        defer { try? FileManager.default.removeItem(at: body.fileURL) }
        let multipart = String(decoding: try Data(contentsOf: body.fileURL), as: UTF8.self)
        XCTAssertTrue(multipart.contains("name=\"model\""))
        XCTAssertTrue(multipart.contains("name=\"structureId\""))
        XCTAssertFalse(multipart.contains("name=\"worldMap\""))
        XCTAssertFalse(multipart.contains("name=\"structureModel\""))
        XCTAssertTrue(multipart.hasSuffix("--\(body.boundary)--\r\n"))

        pending.uploadedScanIDs.insert(draft.id)
        try store.save(pending)
        XCTAssertEqual(try restoredStore.load().first?.uploadedScanIDs, [draft.id])
        try store.remove(id: pendingID)
        XCTAssertTrue(try store.load().isEmpty)
    }

    func testDraftsAreIsolatedByServerOrganizationAndUser() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let draft = try makeDraft(root: root)
        let store = try SpatialScanDraftStore(contextIdentifier: "server#org#user", root: root)
        try store.save(SpatialPendingScan(
            id: UUID(), contextIdentifier: "server#org#user", mode: .newStructure, drafts: [draft], roomResourceIDs: [:], uploadedScanIDs: []
        ))
        for scope in ["server2#org#user", "server#org2#user", "server#org#user2"] {
            let otherStore = try SpatialScanDraftStore(contextIdentifier: scope, root: root)
            XCTAssertTrue(try otherStore.load().isEmpty)
            let pending = try XCTUnwrap(store.load().first)
            XCTAssertThrowsError(try otherStore.save(pending))
        }
    }

    func testContainerRelocationKeepsArtifactsReadable() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let moved = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: moved)
        }
        let draft = try makeDraft(root: root)
        let store = try SpatialScanDraftStore(contextIdentifier: "scope", root: root)
        try store.save(SpatialPendingScan(
            id: UUID(), contextIdentifier: "scope", mode: .newStructure, drafts: [draft], roomResourceIDs: [:], uploadedScanIDs: []
        ))
        try FileManager.default.moveItem(at: root, to: moved)
        let restored = try XCTUnwrap(SpatialScanDraftStore(contextIdentifier: "scope", root: moved).load().first)
        XCTAssertEqual(try Data(contentsOf: restored.drafts[0].modelURL), Data([1, 2, 3]))
    }

    private func makeDraft(root: URL) throws -> SpatialRoomScanDraft {
        let id = UUID()
        let folder = root.appendingPathComponent("inventory-room-scan-\(id.uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let model = folder.appendingPathComponent("room.usdz")
        try Data([1, 2, 3]).write(to: model)
        return SpatialRoomScanDraft(
            id: id, roomName: "Unvollständiger Raum",
            scene: SpatialRoomScene(
                bounds: SpatialRoomBounds(min: [0, 0, 0], max: [1, 1, 1]), surfaces: [], objects: []
            ), capturedAt: Date(), deviceModel: "iPhone", worldMapURL: nil,
            modelURL: model, guideImageURL: nil, structureID: UUID(), structureName: "Gebäude",
            coordinateSpaceID: UUID()
        )
    }
}

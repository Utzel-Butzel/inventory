import Foundation
import XCTest
@testable import Inventory

final class ObjectCaptureSupportTests: XCTestCase {
    func testWorkspaceUsesIsolatedCaptureDirectories() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("object-capture-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: base) }
        let id = try XCTUnwrap(
            UUID(uuidString: "11111111-2222-3333-4444-555555555555")
        )

        let workspace = try ObjectCaptureWorkspace.create(in: base, id: id)

        XCTAssertEqual(workspace.rootURL, base.appendingPathComponent(id.uuidString))
        XCTAssertEqual(workspace.imagesDirectory.lastPathComponent, "Images")
        XCTAssertEqual(workspace.checkpointDirectory.lastPathComponent, "Checkpoints")
        XCTAssertEqual(workspace.modelURL.lastPathComponent, "object.usdz")
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.imagesDirectory.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.checkpointDirectory.path))
        XCTAssertEqual(
            try workspace.rootURL.resourceValues(forKeys: [.isExcludedFromBackupKey])
                .isExcludedFromBackup,
            true
        )

        try workspace.remove()
        XCTAssertFalse(FileManager.default.fileExists(atPath: workspace.rootURL.path))
    }

    func testCapturedModelProducesUSDZUploadMetadata() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("object-capture-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: base) }
        let workspace = try ObjectCaptureWorkspace.create(in: base)
        try Data([0x50, 0x4b, 0x03, 0x04]).write(to: workspace.modelURL)
        let model = CapturedObjectModel(
            id: workspace.id,
            fileURL: workspace.modelURL,
            workspaceURL: workspace.rootURL,
            shotCount: 42,
            byteCount: 4
        )

        XCTAssertEqual(model.uploadFile.mimeType, "model/vnd.usdz+zip")
        XCTAssertTrue(model.uploadFile.filename.hasSuffix(".usdz"))
        XCTAssertEqual(model.uploadFile.fileURL, workspace.modelURL)
    }

    func testProgressNormalizationClampsInvalidAndOutOfRangeValues() {
        XCTAssertEqual(ObjectCaptureProgress.normalized(-1), 0)
        XCTAssertEqual(ObjectCaptureProgress.normalized(0.4), 0.4)
        XCTAssertEqual(ObjectCaptureProgress.normalized(2), 1)
        XCTAssertEqual(ObjectCaptureProgress.normalized(.infinity), 0)
        XCTAssertEqual(ObjectCaptureProgress.normalized(.nan), 0)
    }

    func testStaleWorkspaceCleanupKeepsRecentAndExcludedDirectories() throws {
        let fileManager = FileManager.default
        let base = fileManager.temporaryDirectory
            .appendingPathComponent("object-capture-tests-\(UUID().uuidString)")
        try fileManager.createDirectory(at: base, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: base) }

        let stale = base.appendingPathComponent("stale", isDirectory: true)
        let recent = base.appendingPathComponent("recent", isDirectory: true)
        let excluded = base.appendingPathComponent("excluded", isDirectory: true)
        for directory in [stale, recent, excluded] {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        let now = Date()
        try fileManager.setAttributes(
            [.modificationDate: now.addingTimeInterval(-90_000)],
            ofItemAtPath: stale.path
        )
        try fileManager.setAttributes(
            [.modificationDate: now.addingTimeInterval(-90_000)],
            ofItemAtPath: excluded.path
        )

        ObjectCaptureWorkspace.removeStaleWorkspaces(
            in: base,
            olderThan: now.addingTimeInterval(-86_400),
            excluding: excluded
        )

        XCTAssertFalse(fileManager.fileExists(atPath: stale.path))
        XCTAssertTrue(fileManager.fileExists(atPath: recent.path))
        XCTAssertTrue(fileManager.fileExists(atPath: excluded.path))
    }
}

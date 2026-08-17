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
        XCTAssertEqual(workspace.articleImageURL.lastPathComponent, "article-image.jpg")
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
        try Data([0xff, 0xd8, 0xff, 0xd9]).write(to: workspace.articleImageURL)
        let model = CapturedObjectModel(
            id: workspace.id,
            fileURL: workspace.modelURL,
            articleImageURL: workspace.articleImageURL,
            workspaceURL: workspace.rootURL,
            shotCount: 42,
            byteCount: 4,
            articleImageByteCount: 4
        )

        XCTAssertEqual(model.uploadFile.mimeType, "model/vnd.usdz+zip")
        XCTAssertTrue(model.uploadFile.filename.hasSuffix(".usdz"))
        XCTAssertEqual(model.uploadFile.fileURL, workspace.modelURL)
        XCTAssertEqual(model.articleImageUploadFile.mimeType, "image/jpeg")
        XCTAssertTrue(model.articleImageUploadFile.filename.hasSuffix("-article.jpg"))
        XCTAssertEqual(model.uploadFiles.map(\.mimeType), ["image/jpeg", "model/vnd.usdz+zip"])
    }

    func testArticleImageBuilderSelectsMiddleCaptureAndCreatesBoundedJPEG() async throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("object-capture-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: base) }
        let workspace = try ObjectCaptureWorkspace.create(in: base)
        try TestImageFactory.writeJPEG(
            width: 1_280,
            height: 640,
            to: workspace.imagesDirectory.appendingPathComponent("001.jpg")
        )

        let result = try await ObjectCaptureArticleImageBuilder(
            maximumPixelSize: 640,
            compressionQuality: 0.8
        ).build(
            from: workspace.imagesDirectory,
            destinationURL: workspace.articleImageURL
        )

        XCTAssertEqual(result.fileURL, workspace.articleImageURL)
        XCTAssertEqual(result.pixelWidth, 640)
        XCTAssertEqual(result.pixelHeight, 320)
        XCTAssertGreaterThan(result.byteCount, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: result.fileURL.path))
    }

    func testArticleImageSelectionUsesStableMiddleCapture() throws {
        let directory = URL(fileURLWithPath: "/tmp/object-images", isDirectory: true)
        let candidates = ["010.jpg", "002.jpg", "100.jpg", "001.jpg", "020.jpg"].map {
            directory.appendingPathComponent($0)
        }

        XCTAssertEqual(
            ObjectCaptureArticleImageBuilder.representativeImage(in: candidates)?.lastPathComponent,
            "010.jpg"
        )
        XCTAssertNil(ObjectCaptureArticleImageBuilder.representativeImage(in: []))
    }

    func testProgressNormalizationClampsInvalidAndOutOfRangeValues() {
        XCTAssertEqual(ObjectCaptureProgress.normalized(-1), 0)
        XCTAssertEqual(ObjectCaptureProgress.normalized(0.4), 0.4)
        XCTAssertEqual(ObjectCaptureProgress.normalized(2), 1)
        XCTAssertEqual(ObjectCaptureProgress.normalized(.infinity), 0)
        XCTAssertEqual(ObjectCaptureProgress.normalized(.nan), 0)
    }

    func testObjectCaptureRequestsTransparentDifferenceMattedCover() throws {
        let sourceID = try XCTUnwrap(
            UUID(uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        )
        let request = CoverRequest(
            sourceMediaID: sourceID,
            prompt: "Preserve the exact silhouette",
            modelID: "image-model",
            maximumImageSize: 4_096,
            transparentBackground: true,
            transparencyMethod: .differenceMatting
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request))
                as? [String: Any]
        )

        XCTAssertEqual(object["sourceMediaId"] as? String, sourceID.uuidString)
        XCTAssertEqual(object["prompt"] as? String, "Preserve the exact silhouette")
        XCTAssertEqual(object["modelId"] as? String, "image-model")
        XCTAssertEqual(object["maximumImageSize"] as? Int, 4_096)
        XCTAssertEqual(object["transparentBackground"] as? Bool, true)
        XCTAssertEqual(object["transparencyMethod"] as? String, "difference-matting")
    }

    func testLegacyCoverRequestOmitsMaximumImageSize() throws {
        let request = CoverRequest(
            sourceMediaID: nil,
            prompt: nil,
            modelID: nil,
            transparentBackground: false,
            transparencyMethod: nil
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request))
                as? [String: Any]
        )

        XCTAssertNil(object["maximumImageSize"])
        XCTAssertNil(object["prompt"])
    }

    func testAnalyzeRequestEncodesOptionalPrompt() throws {
        let request = AnalyzeRequest(
            overwrite: true,
            prompt: "Catalog the dominant object"
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request))
                as? [String: Any]
        )

        XCTAssertEqual(object["overwrite"] as? Bool, true)
        XCTAssertEqual(object["prompt"] as? String, "Catalog the dominant object")
    }

    func testLegacyAnalyzeRequestOmitsPrompt() throws {
        let request = AnalyzeRequest(overwrite: true, prompt: nil)

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request))
                as? [String: Any]
        )

        XCTAssertEqual(object["overwrite"] as? Bool, true)
        XCTAssertNil(object["prompt"])
    }

    func testObjectCaptureAISettingsSnapshotNormalizesRequestInputs() {
        let snapshot = ObjectCaptureAISettingsSnapshot(
            analysisPrompt: "  Analyze carefully  ",
            transparentCoverPrompt: "  Preserve fine edges  ",
            imageModelID: "  image-model  ",
            maximumImageSize: 4_096
        )

        XCTAssertEqual(snapshot.analysisPrompt, "Analyze carefully")
        XCTAssertEqual(snapshot.transparentCoverPrompt, "Preserve fine edges")
        XCTAssertEqual(snapshot.imageModelID, "image-model")
        XCTAssertEqual(snapshot.maximumImageSize, 4_096)
    }

    func testObjectCaptureAIRetryRotatesOnlyAfterDefinitiveHTTPFailure() {
        let current = UUID()
        let replacement = UUID()
        let serverFailure = APIClientError.http(
            statusCode: 502,
            message: "provider failed",
            retryAfter: nil
        )
        let processing = APIClientError.http(
            statusCode: 202,
            message: "processing",
            retryAfter: 2
        )

        XCTAssertEqual(
            ObjectCaptureAIIdempotencyPolicy.nextOperationID(
                current: current,
                after: serverFailure,
                makeID: { replacement }
            ),
            replacement
        )
        XCTAssertEqual(
            ObjectCaptureAIIdempotencyPolicy.nextOperationID(
                current: current,
                after: processing,
                makeID: { replacement }
            ),
            current
        )
        XCTAssertEqual(
            ObjectCaptureAIIdempotencyPolicy.nextOperationID(
                current: current,
                after: APIClientError.transport("offline"),
                makeID: { replacement }
            ),
            current
        )
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

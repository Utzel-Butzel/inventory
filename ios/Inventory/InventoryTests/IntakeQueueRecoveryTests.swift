import Foundation
import XCTest
@testable import Inventory

final class IntakeQueueRecoveryTests: XCTestCase {
    func testImageModelSelectionSurvivesManifestRoundTrip() throws {
        let job = makeJob(expectedFileCount: 0, imageModelID: "google-nano-banana-pro")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let decoded = try decoder.decode(IntakeJob.self, from: encoder.encode(job))

        XCTAssertEqual(decoded.imageModelID, "google-nano-banana-pro")
    }

    func testLegacyManifestWithoutImageModelUsesServerDefault() throws {
        let job = makeJob(expectedFileCount: 0)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(job)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertNil(object["imageModelID"])

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(IntakeJob.self, from: data)

        XCTAssertNil(decoded.imageModelID)
    }

    func testPreparingJobRecoversOnlyWhenEveryPhotoExists() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let job = makeJob(expectedFileCount: 2)
        let directory = root.appendingPathComponent(job.id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("first".utf8).write(to: directory.appendingPathComponent("01.jpg"))
        try Data("second".utf8).write(to: directory.appendingPathComponent("02.jpg"))

        let recovered = IntakeQueue.recover(job, rootURL: root)

        XCTAssertEqual(recovered.stage, .queued)
        XCTAssertEqual(recovered.filenames, ["01.jpg", "02.jpg"])
        XCTAssertEqual(recovered.resourceID, nil)
    }

    func testPreparingJobNeverQueuesAPartialPhotoSet() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let job = makeJob(expectedFileCount: 2)
        let directory = root.appendingPathComponent(job.id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("first".utf8).write(to: directory.appendingPathComponent("01.jpg"))

        let recovered = IntakeQueue.recover(job, rootURL: root)

        XCTAssertEqual(recovered.stage, .failed)
        XCTAssertTrue(recovered.filenames.isEmpty)
        XCTAssertNil(recovered.resourceID)
    }

    func testInterruptedJobWithoutOriginIsQuarantined() {
        var job = makeJob(expectedFileCount: 0, mediaUploaded: true)
        job.serverOrigin = nil

        let recovered = IntakeQueue.recover(job, rootURL: temporaryRoot())

        XCTAssertEqual(recovered.stage, .failed)
        XCTAssertTrue(recovered.message?.contains("Serverzuordnung") == true)
    }

    func testPreparingJobKeepsRecoverableSourcesForAutomaticResume() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let first = root.appendingPathComponent("source-1.jpg")
        let second = root.appendingPathComponent("source-2.jpg")
        try Data("first".utf8).write(to: first)
        try Data("second".utf8).write(to: second)
        var job = makeJob(expectedFileCount: 2)
        job.sourceFilePaths = [first.path, second.path]

        let recovered = IntakeQueue.recover(job, rootURL: root)

        XCTAssertEqual(recovered.stage, .preparing)
        XCTAssertEqual(recovered.sourceFilePaths, [first.path, second.path])
        XCTAssertTrue(recovered.message?.contains("fortgesetzt") == true)
    }

    private func makeJob(
        expectedFileCount: Int,
        mediaUploaded: Bool = false,
        imageModelID: String? = nil
    ) -> IntakeJob {
        IntakeJob(
            id: UUID(),
            createdAt: Date(),
            request: ResourceCreateRequest(name: "Test"),
            filenames: [],
            sourceFilePaths: [],
            expectedFileCount: expectedFileCount,
            serverOrigin: "https://inventory.example",
            shouldAnalyze: false,
            shouldGenerateCover: false,
            imageModelID: imageModelID,
            stage: .preparing,
            progress: 0.03,
            resourceID: nil,
            resourceName: nil,
            mediaUploaded: mediaUploaded,
            analysisCompleted: true,
            coverCompleted: true,
            analysisOperationID: nil,
            coverOperationID: nil,
            attemptCount: 0,
            nextAttemptAt: nil,
            message: nil
        )
    }

    private func temporaryRoot() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("InventoryQueueTests", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
    }
}

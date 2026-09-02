import XCTest
@testable import Inventory

final class MultipartBuilderTests: XCTestCase {
    func testBuildsFileBackedMultipartBody() throws {
        let source = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")
        try Data([0x01, 0x02, 0x03, 0x04]).write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }

        let body = try MultipartFormFileBuilder.build(
            files: [MediaUploadFile(fileURL: source, filename: "capture.jpg")]
        )
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let data = try Data(contentsOf: body.fileURL)
        let prefix = try XCTUnwrap(String(data: data.prefix(220), encoding: .utf8))
        XCTAssertTrue(prefix.contains("--\(body.boundary)"))
        XCTAssertTrue(prefix.contains("name=\"files\"; filename=\"capture.jpg\""))
        XCTAssertTrue(prefix.contains("Content-Type: image/jpeg"))
        XCTAssertNotNil(data.range(of: Data("--\(body.boundary)--\r\n".utf8)))
    }

    func testRejectsEmptyFile() throws {
        let source = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try Data().write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }

        XCTAssertThrowsError(
            try MultipartFormFileBuilder.build(files: [MediaUploadFile(fileURL: source)])
        )
    }

    func testBuildsObjectCountBodyWithImageAndHint() throws {
        let source = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")
        try Data([0x01, 0x02, 0x03, 0x04]).write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }

        let itemID = UUID()
        let body = try MultipartFormFileBuilder.buildObjectCount(
            image: MediaUploadFile(fileURL: source, filename: "parts.jpg"),
            itemHint: "rote 3D-Druckteile",
            itemID: itemID,
            modelID: "grounding-dino"
        )
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let data = try Data(contentsOf: body.fileURL)
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains("name=\"image\"; filename=\"parts.jpg\""))
        XCTAssertTrue(text.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(text.contains("name=\"itemHint\""))
        XCTAssertTrue(text.contains("rote 3D-Druckteile"))
        XCTAssertTrue(text.contains("name=\"itemId\""))
        XCTAssertTrue(text.contains(itemID.uuidString.lowercased()))
        XCTAssertTrue(text.contains("name=\"modelId\""))
        XCTAssertTrue(text.contains("grounding-dino"))
        XCTAssertTrue(text.hasSuffix("--\(body.boundary)--\r\n"))
    }

    func testBuildsObjectRecognitionBodyWithExactlyOneImageField() throws {
        let source = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")
        try Data([0xff, 0xd8, 0x01, 0xff, 0xd9]).write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }

        let body = try MultipartFormFileBuilder.buildObjectRecognition(
            image: MediaUploadFile(fileURL: source, filename: "hair-dryer.jpg")
        )
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let text = String(
            decoding: try Data(contentsOf: body.fileURL),
            as: UTF8.self
        )
        XCTAssertEqual(text.components(separatedBy: "name=\"image\"").count - 1, 1)
        XCTAssertTrue(text.contains("filename=\"hair-dryer.jpg\""))
        XCTAssertTrue(text.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(text.hasSuffix("--\(body.boundary)--\r\n"))
    }

    func testUnifiedCameraIncludesRecognitionBetweenScanAndCount() {
        XCTAssertEqual(
            CameraMode.allCases.map(\.rawValue),
            ["capture", "video", "document", "scan", "recognize", "count"]
        )
    }

    func testBuildsVideoAndPDFMultipartPartsWithTheirMIMETypes() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let video = directory.appendingPathComponent("capture.mov")
        let document = directory.appendingPathComponent("scan.pdf")
        try Data([0x00, 0x01, 0x02]).write(to: video)
        try Data("%PDF-1.7".utf8).write(to: document)

        let body = try MultipartFormFileBuilder.build(files: [
            MediaUploadFile(
                fileURL: video,
                filename: "Inventar-Video.mov",
                mimeType: "video/quicktime"
            ),
            MediaUploadFile(
                fileURL: document,
                filename: "Inventar-Dokumentscan.pdf",
                mimeType: "application/pdf"
            ),
        ])
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let text = String(decoding: try Data(contentsOf: body.fileURL), as: UTF8.self)
        XCTAssertTrue(text.contains("filename=\"Inventar-Video.mov\""))
        XCTAssertTrue(text.contains("Content-Type: video/quicktime"))
        XCTAssertTrue(text.contains("filename=\"Inventar-Dokumentscan.pdf\""))
        XCTAssertTrue(text.contains("Content-Type: application/pdf"))
    }

    func testRoomScanBodyIncludesMultiRoomAndGeoreferenceContract() throws {
        let scanID = UUID()
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("inventory-room-scan-\(scanID.uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let worldMapURL = directory.appendingPathComponent("room.arworldmap")
        let modelURL = directory.appendingPathComponent("room.usdz")
        let structureURL = directory.appendingPathComponent("structure.usdz")
        let keyframeID = UUID()
        let keyframeDirectory = directory.appendingPathComponent("keyframes")
        try FileManager.default.createDirectory(
            at: keyframeDirectory,
            withIntermediateDirectories: true
        )
        let keyframeURL = keyframeDirectory
            .appendingPathComponent(keyframeID.uuidString.lowercased())
            .appendingPathExtension("jpg")
        try Data([0x01]).write(to: worldMapURL)
        try Data([0x02]).write(to: modelURL)
        try Data([0x03]).write(to: structureURL)
        try Data([0xff, 0xd8, 0x01, 0xff, 0xd9]).write(to: keyframeURL)

        let structureID = UUID()
        let coordinateSpaceID = UUID()
        let georeference = SpatialStructureGeoreference(
            latitude: 49.452,
            longitude: 11.077,
            altitude: 310,
            headingDegrees: 28,
            horizontalAccuracy: 4,
            verticalAccuracy: 7,
            capturedAt: Date(timeIntervalSince1970: 1_800_000_000),
            source: .gps,
            localReferencePosition: [1, 1.5, -2],
            referencePoints: nil,
            entryMarkerCode: "ENTRANCE-A"
        )
        let draft = SpatialRoomScanDraft(
            id: scanID,
            roomName: "Werkstatt",
            scene: SpatialRoomScene(
                bounds: SpatialRoomBounds(min: [-1, 0, -1], max: [1, 3, 1]),
                surfaces: [],
                objects: []
            ),
            capturedAt: Date(timeIntervalSince1970: 1_800_000_001),
            deviceModel: "iPhone",
            worldMapURL: worldMapURL,
            modelURL: modelURL,
            guideImageURL: nil,
            structureID: structureID,
            structureName: "Rosenwerk",
            floorIdentifier: "EG",
            floorIndex: 0,
            roomIdentifier: "room-a",
            coordinateSpaceID: coordinateSpaceID,
            georeference: georeference,
            structureModelURL: structureURL,
            keyframes: [
                SpatialRoomKeyframeDraft(
                    metadata: SpatialRoomKeyframe(
                        id: keyframeID,
                        capturedAt: Date(timeIntervalSince1970: 1_800_000_000),
                        timestamp: 12.5,
                        cameraTransform: SpatialRoomScene.identityMatrix,
                        intrinsics: [900, 0, 0, 0, 900, 0, 800, 600, 1],
                        width: 1600,
                        height: 1200,
                        orientation: "right",
                        quality: 0.9
                    ),
                    imageURL: keyframeURL
                ),
            ]
        )

        let body = try MultipartFormFileBuilder.buildRoomScan(
            draft: draft,
            roomResourceID: UUID()
        )
        defer { try? FileManager.default.removeItem(at: body.fileURL) }
        let text = String(decoding: try Data(contentsOf: body.fileURL), as: UTF8.self)

        XCTAssertTrue(text.contains("name=\"structureId\""))
        XCTAssertTrue(text.contains(structureID.uuidString.lowercased()))
        XCTAssertTrue(text.contains("name=\"coordinateSpaceId\""))
        XCTAssertTrue(text.contains(coordinateSpaceID.uuidString.lowercased()))
        XCTAssertTrue(text.contains("name=\"georeference\""))
        XCTAssertTrue(text.contains("\"headingDegrees\":28"))
        XCTAssertTrue(text.contains("\"localReferencePosition\":[1,1.5,-2]"))
        XCTAssertTrue(text.contains("name=\"structureModel\"; filename=\"structure.usdz\""))
        XCTAssertTrue(text.contains("name=\"keyframes\""))
        XCTAssertTrue(text.contains("\"id\":\"\(keyframeID.uuidString.lowercased())\""))
        XCTAssertTrue(text.contains("\"fileField\":\"keyframe:\(keyframeID.uuidString.lowercased())\""))
        XCTAssertTrue(text.contains("\"orientation\":\"right\""))
        XCTAssertTrue(
            text.contains(
                "name=\"keyframe:\(keyframeID.uuidString.lowercased())\"; filename=\"\(keyframeID.uuidString.lowercased()).jpg\""
            )
        )
    }
}

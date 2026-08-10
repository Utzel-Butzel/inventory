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

        let body = try MultipartFormFileBuilder.buildObjectCount(
            image: MediaUploadFile(fileURL: source, filename: "parts.jpg"),
            itemHint: "rote 3D-Druckteile"
        )
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let data = try Data(contentsOf: body.fileURL)
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains("name=\"image\"; filename=\"parts.jpg\""))
        XCTAssertTrue(text.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(text.contains("name=\"itemHint\""))
        XCTAssertTrue(text.contains("rote 3D-Druckteile"))
        XCTAssertTrue(text.hasSuffix("--\(body.boundary)--\r\n"))
    }
}

import Foundation
import XCTest
@testable import Inventory

final class JPEGDownsamplerTests: XCTestCase {
    func testLandscapeImageIsBoundedByLargestSide() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let source = directory.appendingPathComponent("source.jpg")
        let destination = directory.appendingPathComponent("result.jpg")
        try TestImageFactory.writeJPEG(width: 2_048, height: 1_024, to: source)

        let result = try await JPEGDownsampler(
            maximumPixelSize: 1_024,
            compressionQuality: 0.8
        ).downsample(sourceURL: source, destinationURL: destination)

        XCTAssertEqual(result.pixelWidth, 1_024)
        XCTAssertEqual(result.pixelHeight, 512)
        XCTAssertGreaterThan(result.byteCount, 0)
    }

    func testPortraitImageIsBoundedByLargestSide() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let source = directory.appendingPathComponent("source.jpg")
        let destination = directory.appendingPathComponent("result.jpg")
        try TestImageFactory.writeJPEG(width: 1_000, height: 2_000, to: source)

        let result = try await JPEGDownsampler(
            maximumPixelSize: 1_600,
            compressionQuality: 0.8
        ).downsample(sourceURL: source, destinationURL: destination)

        XCTAssertEqual(result.pixelWidth, 800)
        XCTAssertEqual(result.pixelHeight, 1_600)
    }

    func testImageSmallerThanLimitIsNotEnlarged() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let source = directory.appendingPathComponent("source.jpg")
        let destination = directory.appendingPathComponent("result.jpg")
        try TestImageFactory.writeJPEG(width: 320, height: 640, to: source)

        let result = try await JPEGDownsampler(
            maximumPixelSize: 1_024,
            compressionQuality: 0.8
        ).downsample(sourceURL: source, destinationURL: destination)

        XCTAssertEqual(result.pixelWidth, 320)
        XCTAssertEqual(result.pixelHeight, 640)
    }

    func testInvalidLargestSideIsRejected() {
        XCTAssertThrowsError(try JPEGDownsampler(maximumPixelSize: 0)) { error in
            XCTAssertEqual(error as? JPEGDownsamplingError, .invalidMaximumPixelSize)
        }
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("JPEGDownsamplerTests", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
    }
}

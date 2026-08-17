import Foundation
import XCTest
@testable import Inventory

final class ImageSizePreferencesTests: XCTestCase {
    func testPresetCatalogsAndDefaults() {
        XCTAssertEqual(ImageSizePreferences.uploadPixelSizes, [1_024, 1_600, 2_200, 4_096])
        XCTAssertEqual(ImageSizePreferences.aiGeneratedPixelSizes, [1_024, 2_048, 4_096])
        XCTAssertEqual(ImageSizePreferences.defaultUploadPixelSize, 2_200)
        XCTAssertEqual(ImageSizePreferences.defaultAIGeneratedPixelSize, 1_024)
    }

    func testMissingPreferencesUseDefaults() throws {
        let (suiteName, defaults) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(
            ImageSizePreferences.maximumUploadImagePixelSize(in: defaults),
            2_200
        )
        XCTAssertEqual(
            ImageSizePreferences.maximumAIGeneratedImagePixelSize(in: defaults),
            1_024
        )
    }

    func testSupportedPreferencesRoundTrip() throws {
        let (suiteName, defaults) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        for pixelSize in ImageSizePreferences.uploadPixelSizes {
            ImageSizePreferences.setMaximumUploadImagePixelSize(pixelSize, in: defaults)
            XCTAssertEqual(
                ImageSizePreferences.maximumUploadImagePixelSize(in: defaults),
                pixelSize
            )
        }
        for pixelSize in ImageSizePreferences.aiGeneratedPixelSizes {
            ImageSizePreferences.setMaximumAIGeneratedImagePixelSize(pixelSize, in: defaults)
            XCTAssertEqual(
                ImageSizePreferences.maximumAIGeneratedImagePixelSize(in: defaults),
                pixelSize
            )
        }
    }

    func testUnsupportedPreferencesFallBackAndPersistValidatedValues() throws {
        let (suiteName, defaults) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(
            ImageSizePreferences.setMaximumUploadImagePixelSize(999, in: defaults),
            2_200
        )
        XCTAssertEqual(
            ImageSizePreferences.setMaximumAIGeneratedImagePixelSize(999, in: defaults),
            1_024
        )
        XCTAssertEqual(
            ImageSizePreferences.maximumUploadImagePixelSize(in: defaults),
            2_200
        )
        XCTAssertEqual(
            ImageSizePreferences.maximumAIGeneratedImagePixelSize(in: defaults),
            1_024
        )
    }

    private func makeDefaults() throws -> (String, UserDefaults) {
        let suiteName = "ImageSizePreferencesTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        return (suiteName, defaults)
    }
}

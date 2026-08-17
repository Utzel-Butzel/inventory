import Foundation

enum ImageSizePreferences {
    static let uploadPixelSizes = [1_024, 1_600, 2_200, 4_096]
    static let aiGeneratedPixelSizes = [1_024, 2_048, 4_096]

    static let defaultUploadPixelSize = 2_200
    static let defaultAIGeneratedPixelSize = 1_024

    private static let uploadPixelSizeKey = "inventory.maximumUploadImagePixelSize"
    private static let aiGeneratedPixelSizeKey =
        "inventory.maximumAIGeneratedImagePixelSize"

    static func maximumUploadImagePixelSize(in defaults: UserDefaults) -> Int {
        validatedUploadPixelSize(defaults.object(forKey: uploadPixelSizeKey) as? Int)
    }

    static func maximumAIGeneratedImagePixelSize(in defaults: UserDefaults) -> Int {
        validatedAIGeneratedPixelSize(
            defaults.object(forKey: aiGeneratedPixelSizeKey) as? Int
        )
    }

    @discardableResult
    static func setMaximumUploadImagePixelSize(
        _ pixelSize: Int,
        in defaults: UserDefaults
    ) -> Int {
        let validated = validatedUploadPixelSize(pixelSize)
        defaults.set(validated, forKey: uploadPixelSizeKey)
        return validated
    }

    @discardableResult
    static func setMaximumAIGeneratedImagePixelSize(
        _ pixelSize: Int,
        in defaults: UserDefaults
    ) -> Int {
        let validated = validatedAIGeneratedPixelSize(pixelSize)
        defaults.set(validated, forKey: aiGeneratedPixelSizeKey)
        return validated
    }

    static func validatedUploadPixelSize(_ pixelSize: Int?) -> Int {
        validated(
            pixelSize,
            supported: uploadPixelSizes,
            fallback: defaultUploadPixelSize
        )
    }

    static func validatedAIGeneratedPixelSize(_ pixelSize: Int?) -> Int {
        validated(
            pixelSize,
            supported: aiGeneratedPixelSizes,
            fallback: defaultAIGeneratedPixelSize
        )
    }

    private static func validated(
        _ pixelSize: Int?,
        supported: [Int],
        fallback: Int
    ) -> Int {
        guard let pixelSize, supported.contains(pixelSize) else { return fallback }
        return pixelSize
    }
}

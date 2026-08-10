import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct ProcessedJPEG: Equatable, Sendable {
    public let fileURL: URL
    public let pixelWidth: Int
    public let pixelHeight: Int
    public let byteCount: Int64

    public init(fileURL: URL, pixelWidth: Int, pixelHeight: Int, byteCount: Int64) {
        self.fileURL = fileURL
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.byteCount = byteCount
    }
}

public enum JPEGDownsamplingError: Error, LocalizedError, Sendable {
    case invalidMaximumPixelSize
    case invalidCompressionQuality
    case unreadableSource
    case unableToCreateThumbnail
    case unableToCreateDestination
    case unableToFinalizeDestination
    case unableToReadOutputSize

    public var errorDescription: String? {
        switch self {
        case .invalidMaximumPixelSize:
            return "The maximum image size must be greater than zero."
        case .invalidCompressionQuality:
            return "JPEG compression quality must be between zero and one."
        case .unreadableSource:
            return "The source image could not be read."
        case .unableToCreateThumbnail:
            return "The source image could not be downsampled."
        case .unableToCreateDestination:
            return "The JPEG destination could not be created."
        case .unableToFinalizeDestination:
            return "The JPEG could not be written."
        case .unableToReadOutputSize:
            return "The size of the processed JPEG could not be determined."
        }
    }
}

/// Downsamples directly through ImageIO, avoiding a full-resolution UIImage.
/// The default mirrors the web client's 2,200-pixel upload limit.
public actor JPEGDownsampler {
    public let maximumPixelSize: Int
    public let compressionQuality: Double

    public init(maximumPixelSize: Int = 2_200, compressionQuality: Double = 0.86) throws {
        guard maximumPixelSize > 0 else {
            throw JPEGDownsamplingError.invalidMaximumPixelSize
        }
        guard (0 ... 1).contains(compressionQuality) else {
            throw JPEGDownsamplingError.invalidCompressionQuality
        }
        self.maximumPixelSize = maximumPixelSize
        self.compressionQuality = compressionQuality
    }

    public func downsample(
        sourceURL: URL,
        destinationURL: URL
    ) throws -> ProcessedJPEG {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, sourceOptions) else {
            throw JPEGDownsamplingError.unreadableSource
        }
        return try writeDownsampledJPEG(from: source, destinationURL: destinationURL)
    }

    /// Useful for AVCapturePhoto output, which already arrives as encoded Data.
    public func downsample(
        encodedImageData: Data,
        destinationURL: URL
    ) throws -> ProcessedJPEG {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(
            encodedImageData as CFData,
            sourceOptions
        ) else {
            throw JPEGDownsamplingError.unreadableSource
        }
        return try writeDownsampledJPEG(from: source, destinationURL: destinationURL)
    }

    private func writeDownsampledJPEG(
        from source: CGImageSource,
        destinationURL: URL
    ) throws -> ProcessedJPEG {
        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(
            source,
            CGImageSourceGetPrimaryImageIndex(source),
            thumbnailOptions as CFDictionary
        ) else {
            throw JPEGDownsamplingError.unableToCreateThumbnail
        }

        guard let destination = CGImageDestinationCreateWithURL(
            destinationURL as CFURL,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw JPEGDownsamplingError.unableToCreateDestination
        }

        let properties: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: compressionQuality,
            kCGImagePropertyOrientation: 1,
        ]
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw JPEGDownsamplingError.unableToFinalizeDestination
        }

        let attributes = try FileManager.default.attributesOfItem(atPath: destinationURL.path)
        guard let byteCount = (attributes[.size] as? NSNumber)?.int64Value else {
            throw JPEGDownsamplingError.unableToReadOutputSize
        }
        return ProcessedJPEG(
            fileURL: destinationURL,
            pixelWidth: image.width,
            pixelHeight: image.height,
            byteCount: byteCount
        )
    }
}

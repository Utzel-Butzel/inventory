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
    case invalidCropAspectRatio
    case unableToCropImage

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
        case .invalidCropAspectRatio:
            return "The requested image crop aspect ratio is invalid."
        case .unableToCropImage:
            return "The image could not be cropped to the camera viewfinder."
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
        destinationURL: URL,
        cropAspectRatio: CGFloat? = nil
    ) throws -> ProcessedJPEG {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, sourceOptions) else {
            throw JPEGDownsamplingError.unreadableSource
        }
        return try writeDownsampledJPEG(
            from: source,
            destinationURL: destinationURL,
            cropAspectRatio: cropAspectRatio
        )
    }

    /// Useful for AVCapturePhoto output, which already arrives as encoded Data.
    public func downsample(
        encodedImageData: Data,
        destinationURL: URL,
        cropAspectRatio: CGFloat? = nil
    ) throws -> ProcessedJPEG {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(
            encodedImageData as CFData,
            sourceOptions
        ) else {
            throw JPEGDownsamplingError.unreadableSource
        }
        return try writeDownsampledJPEG(
            from: source,
            destinationURL: destinationURL,
            cropAspectRatio: cropAspectRatio
        )
    }

    private func writeDownsampledJPEG(
        from source: CGImageSource,
        destinationURL: URL,
        cropAspectRatio: CGFloat?
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

        let outputImage = try centerCroppedImage(image, aspectRatio: cropAspectRatio)

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
        CGImageDestinationAddImage(destination, outputImage, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw JPEGDownsamplingError.unableToFinalizeDestination
        }

        let attributes = try FileManager.default.attributesOfItem(atPath: destinationURL.path)
        guard let byteCount = (attributes[.size] as? NSNumber)?.int64Value else {
            throw JPEGDownsamplingError.unableToReadOutputSize
        }
        return ProcessedJPEG(
            fileURL: destinationURL,
            pixelWidth: outputImage.width,
            pixelHeight: outputImage.height,
            byteCount: byteCount
        )
    }

    private func centerCroppedImage(
        _ image: CGImage,
        aspectRatio: CGFloat?
    ) throws -> CGImage {
        guard let aspectRatio else { return image }
        guard aspectRatio.isFinite, aspectRatio > 0 else {
            throw JPEGDownsamplingError.invalidCropAspectRatio
        }

        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        let currentAspectRatio = width / height
        guard abs(currentAspectRatio - aspectRatio) > 0.000_1 else { return image }

        let cropRect: CGRect
        if currentAspectRatio > aspectRatio {
            let croppedWidth = floor(height * aspectRatio)
            cropRect = CGRect(
                x: floor((width - croppedWidth) / 2),
                y: 0,
                width: croppedWidth,
                height: height
            )
        } else {
            let croppedHeight = floor(width / aspectRatio)
            cropRect = CGRect(
                x: 0,
                y: floor((height - croppedHeight) / 2),
                width: width,
                height: croppedHeight
            )
        }

        guard let cropped = image.cropping(to: cropRect.integral) else {
            throw JPEGDownsamplingError.unableToCropImage
        }
        return cropped
    }
}

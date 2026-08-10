import ImageIO
import SwiftUI
import UIKit

struct LocalThumbnail: View {
    let url: URL
    var size: CGFloat = 88
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Rectangle()
                    .fill(.secondary.opacity(0.12))
                    .overlay { ProgressView().controlSize(.small) }
            }
        }
        .frame(width: size, height: size)
        .clipped()
        .task(id: url) {
            image = await Self.load(url: url, pixelSize: Int(size * 3))
        }
    }

    private static func load(url: URL, pixelSize: Int) async -> UIImage? {
        await Task.detached(priority: .utility) {
            let options = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithURL(url as CFURL, options) else {
                return nil
            }
            let thumbnailOptions: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: pixelSize,
                kCGImageSourceShouldCacheImmediately: true,
            ]
            guard let cgImage = CGImageSourceCreateThumbnailAtIndex(
                source,
                0,
                thumbnailOptions as CFDictionary
            ) else { return nil }
            return UIImage(cgImage: cgImage)
        }.value
    }
}

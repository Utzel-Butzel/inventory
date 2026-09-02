import CoreText
import ImageIO
import SwiftUI
import UIKit
import Vision
import VisionKit

enum InventoryDocumentScannerError: Error, LocalizedError {
    case unavailable
    case emptyScan
    case unreadablePage
    case pdfCreationFailed

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "Der Dokumentenscanner wird auf diesem Gerät nicht unterstützt."
        case .emptyScan:
            "Der Scan enthält keine Seiten."
        case .unreadablePage:
            "Mindestens eine Dokumentseite konnte nicht gelesen werden."
        case .pdfCreationFailed:
            "Das durchsuchbare PDF konnte nicht erstellt werden."
        }
    }
}

struct InventoryDocumentScannerView: UIViewControllerRepresentable {
    let onRecognizing: @MainActor () -> Void
    let onComplete: @MainActor (Result<MediaUploadFile, Error>) -> Void
    let onCancel: @MainActor () -> Void

    static var isSupported: Bool {
        VNDocumentCameraViewController.isSupported
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onRecognizing: onRecognizing,
            onComplete: onComplete,
            onCancel: onCancel
        )
    }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(
        _ uiViewController: VNDocumentCameraViewController,
        context: Context
    ) { }

    @MainActor
    final class Coordinator: NSObject, @preconcurrency VNDocumentCameraViewControllerDelegate {
        private let onRecognizing: @MainActor () -> Void
        private let onComplete: @MainActor (Result<MediaUploadFile, Error>) -> Void
        private let onCancel: @MainActor () -> Void

        init(
            onRecognizing: @escaping @MainActor () -> Void,
            onComplete: @escaping @MainActor (Result<MediaUploadFile, Error>) -> Void,
            onCancel: @escaping @MainActor () -> Void
        ) {
            self.onRecognizing = onRecognizing
            self.onComplete = onComplete
            self.onCancel = onCancel
        }

        func documentCameraViewControllerDidCancel(
            _ controller: VNDocumentCameraViewController
        ) {
            controller.dismiss(animated: true)
            onCancel()
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFailWithError error: Error
        ) {
            controller.dismiss(animated: true)
            onComplete(.failure(error))
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFinishWith scan: VNDocumentCameraScan
        ) {
            let pageData = (0 ..< scan.pageCount).compactMap {
                scan.imageOfPage(at: $0).jpegData(compressionQuality: 0.88)
            }
            controller.dismiss(animated: true)
            guard pageData.count == scan.pageCount, !pageData.isEmpty else {
                onComplete(.failure(InventoryDocumentScannerError.emptyScan))
                return
            }
            onRecognizing()
            Task {
                do {
                    let file = try await SearchableDocumentPDF.create(from: pageData)
                    onComplete(.success(file))
                } catch {
                    onComplete(.failure(error))
                }
            }
        }
    }
}

private enum SearchableDocumentPDF {
    private struct RecognizedLine {
        let text: String
        let bounds: CGRect
    }

    private struct Page {
        let image: UIImage
        let lines: [RecognizedLine]
    }

    static func create(from sourcePages: [Data]) async throws -> MediaUploadFile {
        try await Task.detached(priority: .userInitiated) {
            let pages = try sourcePages.map { source in
                guard let original = UIImage(data: source) else {
                    throw InventoryDocumentScannerError.unreadablePage
                }
                let image = preparedImage(original)
                return Page(image: image, lines: try recognizeText(in: image))
            }
            let data = render(pages: pages)
            guard !data.isEmpty else {
                throw InventoryDocumentScannerError.pdfCreationFailed
            }
            let directory = FileManager.default.urls(
                for: .cachesDirectory,
                in: .userDomainMask
            )[0].appendingPathComponent("InventoryCapture", isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            let url = directory
                .appendingPathComponent("document-\(UUID().uuidString)")
                .appendingPathExtension("pdf")
            try data.write(to: url, options: .atomic)
            return MediaUploadFile(
                fileURL: url,
                filename: "Inventar-Dokumentscan.pdf",
                mimeType: "application/pdf"
            )
        }.value
    }

    private static func preparedImage(_ source: UIImage) -> UIImage {
        let maximumDimension: CGFloat = 2_200
        let longest = max(source.size.width, source.size.height)
        guard longest > maximumDimension else { return source }
        let scale = maximumDimension / longest
        let size = CGSize(
            width: max(1, (source.size.width * scale).rounded()),
            height: max(1, (source.size.height * scale).rounded())
        )
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            source.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    private static func recognizeText(in image: UIImage) throws -> [RecognizedLine] {
        guard let cgImage = image.cgImage else {
            throw InventoryDocumentScannerError.unreadablePage
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["de-DE", "en-US"]
        request.usesLanguageCorrection = true
        request.automaticallyDetectsLanguage = true
        let handler = VNImageRequestHandler(
            cgImage: cgImage,
            orientation: image.imageOrientation.cgImageOrientation
        )
        try handler.perform([request])
        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return RecognizedLine(text: text, bounds: observation.boundingBox)
        }
    }

    private static func render(pages: [Page]) -> Data {
        let pageBounds = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [
            kCGPDFContextTitle as String: "Inventar-Dokumentscan",
            kCGPDFContextCreator as String: "Open Inventory",
        ]
        return UIGraphicsPDFRenderer(bounds: pageBounds, format: format).pdfData { renderer in
            for page in pages {
                renderer.beginPage()
                let imageRect = aspectFit(page.image.size, in: pageBounds.insetBy(dx: 18, dy: 18))
                page.image.draw(in: imageRect)
                drawInvisibleText(page.lines, in: imageRect, context: renderer.cgContext)
            }
        }
    }

    private static func aspectFit(_ size: CGSize, in bounds: CGRect) -> CGRect {
        let scale = min(bounds.width / max(1, size.width), bounds.height / max(1, size.height))
        let fitted = CGSize(width: size.width * scale, height: size.height * scale)
        return CGRect(
            x: bounds.midX - fitted.width / 2,
            y: bounds.midY - fitted.height / 2,
            width: fitted.width,
            height: fitted.height
        )
    }

    private static func drawInvisibleText(
        _ lines: [RecognizedLine],
        in imageRect: CGRect,
        context: CGContext
    ) {
        for recognized in lines {
            let target = CGRect(
                x: imageRect.minX + recognized.bounds.minX * imageRect.width,
                y: imageRect.minY + (1 - recognized.bounds.maxY) * imageRect.height,
                width: recognized.bounds.width * imageRect.width,
                height: recognized.bounds.height * imageRect.height
            )
            guard target.width > 1, target.height > 1 else { continue }
            let font = CTFontCreateWithName(
                "Helvetica" as CFString,
                max(4, target.height * 0.82),
                nil
            )
            let attributed = CFAttributedStringCreate(
                nil,
                recognized.text as CFString,
                [kCTFontAttributeName: font] as CFDictionary
            )!
            let line = CTLineCreateWithAttributedString(attributed)
            let lineWidth = max(1, CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil)))

            context.saveGState()
            context.setTextDrawingMode(.invisible)
            context.textMatrix = .identity
            context.translateBy(x: target.minX, y: target.maxY - target.height * 0.08)
            context.scaleBy(x: min(1, target.width / lineWidth), y: -1)
            context.textPosition = .zero
            CTLineDraw(line, context)
            context.restoreGState()
        }
    }
}

private extension UIImage.Orientation {
    var cgImageOrientation: CGImagePropertyOrientation {
        switch self {
        case .up: .up
        case .upMirrored: .upMirrored
        case .down: .down
        case .downMirrored: .downMirrored
        case .left: .left
        case .leftMirrored: .leftMirrored
        case .right: .right
        case .rightMirrored: .rightMirrored
        @unknown default: .up
        }
    }
}

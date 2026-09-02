import Foundation
import PhotosUI
import SwiftUI

struct CapturedInventoryPhoto: Identifiable, Equatable, Sendable {
    let id: UUID
    let fileURL: URL
    let byteCount: Int64

    init(id: UUID = UUID(), fileURL: URL, byteCount: Int64) {
        self.id = id
        self.fileURL = fileURL
        self.byteCount = byteCount
    }
}

struct CapturedInventoryAttachment: Identifiable, Equatable, Sendable {
    enum Kind: String, Sendable {
        case video
        case document
    }

    let id: UUID
    let file: MediaUploadFile
    let byteCount: Int64
    let kind: Kind

    init(
        id: UUID = UUID(),
        file: MediaUploadFile,
        byteCount: Int64,
        kind: Kind
    ) {
        self.id = id
        self.file = file
        self.byteCount = byteCount
        self.kind = kind
    }
}

struct IntakeSubmission: Sendable {
    let id: UUID
    let request: ResourceCreateRequest
    let photos: [MediaUploadFile]
    let analyze: Bool
    let generateCover: Bool
    let imageModelID: String?
    let maximumAIGeneratedImagePixelSize: Int
    let analysisPrompt: String?
    let coverPrompt: String?
    let spatialPlacement: SpatialPlacementDraft?
}

@MainActor
final class CaptureViewModel: ObservableObject {
    static let maximumPhotos = 12

    @Published var name = ""
    @Published var resourceType: InventoryResourceType = .object
    @Published var sku = ""
    @Published var barcode = ""
    @Published var serialNumber = ""
    @Published var locationName = ""
    @Published var autoAnalyze = true
    @Published var autoCover = true
    @Published private(set) var photos: [CapturedInventoryPhoto] = []
    @Published private(set) var attachments: [CapturedInventoryAttachment] = []
    @Published private(set) var processingCount = 0
    @Published var errorMessage: String?
    @Published private(set) var spatialPlacement: SpatialPlacementDraft?

    let locationService = LocationService()
    private let downsampler: JPEGDownsampler

    init(maximumPixelSize: Int = ImageSizePreferences.defaultUploadPixelSize) {
        downsampler = try! JPEGDownsampler(
            maximumPixelSize: maximumPixelSize,
            compressionQuality: 0.86
        )
    }

    var canSubmit: Bool {
        !photos.isEmpty ||
            !attachments.isEmpty ||
            !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !sku.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !barcode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !serialNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var mediaCount: Int {
        photos.count + attachments.count
    }

    func addCapturedData(_ data: Data) {
        addEncodedData(data, cropAspectRatio: nil)
    }

    /// Camera shutter photos mirror their viewfinder. Imported and spatial
    /// images intentionally retain their original composition.
    func addCameraCapturedData(
        _ data: Data,
        cropAspectRatio: CGFloat = CameraService.photoAspectRatio
    ) {
        addEncodedData(data, cropAspectRatio: cropAspectRatio)
    }

    private func addEncodedData(_ data: Data, cropAspectRatio: CGFloat?) {
        guard mediaCount + processingCount < Self.maximumPhotos else {
            errorMessage = "Pro Gegenstand sind höchstens zwölf Mediendateien möglich."
            return
        }
        processingCount += 1
        errorMessage = nil
        let destination = Self.makePhotoURL()
        Task {
            do {
                let image = try await downsampler.downsample(
                    encodedImageData: data,
                    destinationURL: destination,
                    cropAspectRatio: cropAspectRatio
                )
                photos.append(
                    CapturedInventoryPhoto(
                        fileURL: image.fileURL,
                        byteCount: image.byteCount
                    )
                )
            } catch {
                errorMessage = error.localizedDescription
                try? FileManager.default.removeItem(at: destination)
            }
            processingCount -= 1
        }
    }

    func addPickerItems(_ items: [PhotosPickerItem]) {
        let openSlots = Self.maximumPhotos - mediaCount - processingCount
        guard openSlots > 0 else {
            errorMessage = "Pro Gegenstand sind höchstens zwölf Mediendateien möglich."
            return
        }
        for item in items.prefix(openSlots) {
            processingCount += 1
            Task {
                defer { processingCount -= 1 }
                do {
                    guard let data = try await item.loadTransferable(type: Data.self) else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    let destination = Self.makePhotoURL()
                    do {
                        let image = try await downsampler.downsample(
                            encodedImageData: data,
                            destinationURL: destination
                        )
                        photos.append(
                            CapturedInventoryPhoto(
                                fileURL: image.fileURL,
                                byteCount: image.byteCount
                            )
                        )
                    } catch {
                        try? FileManager.default.removeItem(at: destination)
                        throw error
                    }
                } catch {
                    errorMessage = "Ein Foto konnte nicht vorbereitet werden: \(error.localizedDescription)"
                }
            }
        }
    }

    func removePhoto(_ photo: CapturedInventoryPhoto) {
        photos.removeAll { $0.id == photo.id }
        try? FileManager.default.removeItem(at: photo.fileURL)
    }

    func addAttachment(_ file: MediaUploadFile, kind: CapturedInventoryAttachment.Kind) {
        guard mediaCount + processingCount < Self.maximumPhotos else {
            errorMessage = "Pro Gegenstand sind höchstens zwölf Mediendateien möglich."
            try? FileManager.default.removeItem(at: file.fileURL)
            return
        }
        do {
            let values = try file.fileURL.resourceValues(forKeys: [
                .isRegularFileKey,
                .fileSizeKey,
            ])
            guard values.isRegularFile == true, let size = values.fileSize, size > 0 else {
                throw CocoaError(.fileReadNoSuchFile)
            }
            attachments.append(
                CapturedInventoryAttachment(
                    file: file,
                    byteCount: Int64(size),
                    kind: kind
                )
            )
            errorMessage = nil
        } catch {
            errorMessage = "Die Mediendatei konnte nicht hinzugefügt werden: \(error.localizedDescription)"
            try? FileManager.default.removeItem(at: file.fileURL)
        }
    }

    func removeAttachment(_ attachment: CapturedInventoryAttachment) {
        attachments.removeAll { $0.id == attachment.id }
        try? FileManager.default.removeItem(at: attachment.file.fileURL)
    }

    func applyScannedCode(_ rawCode: String) {
        let code = rawCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }
        if code.count <= 180 {
            barcode = code
        } else {
            errorMessage = "Der gescannte Code ist länger als die unterstützten 180 Zeichen."
        }
    }

    func applySpatialPlacement(_ placement: SpatialPlacementDraft) {
        spatialPlacement = placement
        locationName = placement.roomName
    }

    func clearSpatialPlacement() {
        spatialPlacement = nil
    }

    func makeSubmission(
        imageModelID: String? = nil,
        maximumAIGeneratedImagePixelSize: Int = ImageSizePreferences
            .defaultAIGeneratedPixelSize,
        analysisPrompt: String? = nil,
        coverPrompt: String? = nil
    ) -> IntakeSubmission {
        let coordinates = locationService.coordinates
        let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let request = ResourceCreateRequest(
            name: normalizedName.isEmpty
                ? (sku.nilIfBlank ?? barcode.nilIfBlank ?? serialNumber.nilIfBlank ?? "Untitled item")
                : normalizedName,
            type: resourceType,
            sku: sku.nilIfBlank,
            barcode: barcode.nilIfBlank,
            location: locationName.nilIfBlank,
            serialNumber: serialNumber.nilIfBlank,
            gpsLatitude: coordinates?.latitude,
            gpsLongitude: coordinates?.longitude,
            gpsAltitude: coordinates?.altitude
        )
        return IntakeSubmission(
            id: UUID(),
            request: request,
            photos: photos.map {
                MediaUploadFile(fileURL: $0.fileURL, filename: $0.fileURL.lastPathComponent)
            } + attachments.map(\.file),
            analyze: autoAnalyze && !photos.isEmpty,
            generateCover: autoAnalyze && autoCover && !photos.isEmpty,
            imageModelID: imageModelID,
            maximumAIGeneratedImagePixelSize: ImageSizePreferences
                .validatedAIGeneratedPixelSize(maximumAIGeneratedImagePixelSize),
            analysisPrompt: AIPromptPreferences.validatedPrompt(analysisPrompt),
            coverPrompt: AIPromptPreferences.validatedPrompt(coverPrompt),
            spatialPlacement: spatialPlacement
        )
    }

    func resetAfterSubmitting() {
        name = ""
        sku = ""
        barcode = ""
        serialNumber = ""
        photos = []
        attachments = []
        spatialPlacement = nil
        errorMessage = nil
    }

    private static func makePhotoURL() -> URL {
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("InventoryCapture", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")
    }
}

private extension String {
    var nilIfBlank: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

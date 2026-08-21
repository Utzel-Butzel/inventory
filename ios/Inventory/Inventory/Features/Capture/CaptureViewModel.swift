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
            !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !sku.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !barcode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !serialNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
        guard photos.count + processingCount < Self.maximumPhotos else {
            errorMessage = "Pro Gegenstand sind höchstens zwölf Fotos möglich."
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
        let openSlots = Self.maximumPhotos - photos.count - processingCount
        guard openSlots > 0 else {
            errorMessage = "Pro Gegenstand sind höchstens zwölf Fotos möglich."
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
            },
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

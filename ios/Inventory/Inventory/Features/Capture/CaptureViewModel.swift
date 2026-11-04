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
    var research: Bool = false
    var analysisOverwrite: Bool = true
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
    @Published var autoAnalyze = true { didSet { if !applyingAIDefaults { analysisTouched = true } } }
    @Published var autoResearch = false { didSet { if !applyingAIDefaults { researchTouched = true } } }
    @Published var analysisOverwrite = true { didSet { if !applyingAIDefaults { overwriteTouched = true } } }
    @Published private(set) var aiDefaultsLoaded = false
    private var aiDefaultsContext: String?
    private var applyingAIDefaults = false
    private var analysisTouched = false
    private var researchTouched = false
    private var overwriteTouched = false
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

    func loadAIDefaults(from state: AppState) async {
        if aiDefaultsContext != state.organizationContextIdentifier {
            analysisTouched = false
            researchTouched = false
            overwriteTouched = false
            aiDefaultsContext = state.organizationContextIdentifier
        }
        aiDefaultsLoaded = false
        guard state.canUseAI else { aiDefaultsLoaded = true; return }
        if let cached = state.inventoryAISettings {
            applyAIDefaults(cached.inventorySettings, canAnalyze: state.canAnalyzeInventory, canResearch: state.canResearchInventory)
            aiDefaultsLoaded = true
        }
        do {
            let settings = try await state.refreshInventoryAISettings()
            applyAIDefaults(settings.inventorySettings, canAnalyze: state.canAnalyzeInventory, canResearch: state.canResearchInventory)
            aiDefaultsLoaded = true
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            if let cached = state.inventoryAISettings {
                applyAIDefaults(cached.inventorySettings, canAnalyze: state.canAnalyzeInventory, canResearch: state.canResearchInventory)
                errorMessage = L10n.text("ui_could_not_update_ai_defaults_the_last_70c7320d")
            } else {
                applyingAIDefaults = true
                autoAnalyze = false
                autoResearch = false
                applyingAIDefaults = false
                errorMessage = L10n.text("ui_ai_defaults_are_unavailable_you_can_save_4c3a0cf1")
            }
            aiDefaultsLoaded = true
        }
    }

    func applyAIDefaults(_ settings: InventoryAISettings, canAnalyze: Bool, canResearch: Bool) {
        applyingAIDefaults = true
        if !analysisTouched { autoAnalyze = canAnalyze && settings.autoAnalyze }
        if !researchTouched { autoResearch = canResearch && settings.autoResearch }
        if !overwriteTouched { analysisOverwrite = settings.overwrite }
        applyingAIDefaults = false
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
            errorMessage = L10n.text("ui_a_maximum_of_twelve_media_files_is_cb9e8a91")
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
            errorMessage = L10n.text("ui_a_maximum_of_twelve_media_files_is_cb9e8a91")
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
                    errorMessage = L10n.text("ui_could_not_prepare_a_photo_0_a7637834", error.localizedDescription)
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
            errorMessage = L10n.text("ui_a_maximum_of_twelve_media_files_is_cb9e8a91")
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
            errorMessage = L10n.text("ui_could_not_add_the_media_file_0_c36ae92a", error.localizedDescription)
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
            errorMessage = L10n.text("ui_the_scanned_code_exceeds_the_supported_180_9f6b20ae")
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
                ? (sku.nilIfBlank ?? barcode.nilIfBlank ?? serialNumber.nilIfBlank ?? L10n.text("ui_untitled_item_5f9e46c7"))
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
            spatialPlacement: spatialPlacement,
            research: autoResearch,
            analysisOverwrite: analysisOverwrite
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

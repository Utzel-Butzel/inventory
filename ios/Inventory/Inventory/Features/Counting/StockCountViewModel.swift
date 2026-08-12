import Foundation

enum StockCountOperation: Equatable, Sendable {
    case receipt
    case issue

    var stockType: String {
        switch self {
        case .receipt: "receipt"
        case .issue: "issue"
        }
    }

    var sign: Int {
        switch self {
        case .receipt: 1
        case .issue: -1
        }
    }

    var reason: String {
        switch self {
        case .receipt: "Fotozählung: Zugang per iOS-App"
        case .issue: "Fotozählung: Entnahme per iOS-App"
        }
    }
}

@MainActor
final class StockCountViewModel: ObservableObject {
    static let maximumCount = 1_000_000
    static let maximumItemHintUTF16Length = 240

    enum Phase: Equatable {
        case camera
        case preparingPhoto
        case analyzing
        case result
        case booking
    }

    @Published var itemHint: String {
        didSet {
            let limited = Self.limitItemHint(itemHint)
            if limited != itemHint {
                itemHint = limited
            }
        }
    }
    @Published private(set) var phase: Phase = .camera
    @Published private(set) var photoURL: URL?
    @Published private(set) var result: ObjectCountResponse?
    @Published var adjustedCount = 0 {
        didSet {
            if adjustedCount < 0 {
                adjustedCount = 0
            } else if adjustedCount > Self.maximumCount {
                adjustedCount = Self.maximumCount
            }
            if adjustedCount != oldValue {
                pendingMovement = nil
            }
        }
    }
    @Published var errorMessage: String?

    private struct PendingMovement: Equatable {
        let id: UUID
        let operation: StockCountOperation
        let count: Int
    }

    private let downsampler: JPEGDownsampler
    private var analysisTask: Task<Void, Never>?
    private var pendingMovement: PendingMovement?

    init(itemHint: String) {
        self.itemHint = Self.limitItemHint(itemHint)
        downsampler = try! JPEGDownsampler(
            maximumPixelSize: 2_200,
            compressionQuality: 0.86
        )
    }

    var isBusy: Bool {
        switch phase {
        case .preparingPhoto, .analyzing, .booking: true
        case .camera, .result: false
        }
    }

    var isAnalyzing: Bool {
        phase == .preparingPhoto || phase == .analyzing
    }

    var canApplyReceipt: Bool {
        result != nil && adjustedCount > 0 && !isBusy
    }

    func canApplyIssue(currentQuantity: Int) -> Bool {
        result != nil && adjustedCount > 0 && adjustedCount <= currentQuantity && !isBusy
    }

    func analyzeCapturedData(_ data: Data, using client: APIClient) {
        guard !isBusy else { return }
        analysisTask?.cancel()
        removePhoto()
        result = nil
        adjustedCount = 0
        errorMessage = nil
        phase = .preparingPhoto

        let destination = Self.makePhotoURL()
        analysisTask = Task { [weak self] in
            guard let self else { return }
            do {
                let image = try await downsampler.downsample(
                    encodedImageData: data,
                    destinationURL: destination,
                    cropAspectRatio: CameraService.photoAspectRatio
                )
                try Task.checkCancellation()
                photoURL = image.fileURL
                phase = .analyzing
                try await analyzePreparedPhoto(using: client)
            } catch is CancellationError {
                try? FileManager.default.removeItem(at: destination)
            } catch {
                if photoURL == nil {
                    try? FileManager.default.removeItem(at: destination)
                    phase = .camera
                } else {
                    phase = .result
                }
                errorMessage = error.localizedDescription
            }
            analysisTask = nil
        }
    }

    func retryAnalysis(using client: APIClient) {
        guard photoURL != nil, !isBusy else { return }
        analysisTask?.cancel()
        result = nil
        adjustedCount = 0
        errorMessage = nil
        phase = .analyzing
        analysisTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await analyzePreparedPhoto(using: client)
            } catch is CancellationError {
                phase = .result
            } catch {
                phase = .result
                errorMessage = error.localizedDescription
            }
            analysisTask = nil
        }
    }

    func retake() {
        guard phase != .booking else { return }
        analysisTask?.cancel()
        analysisTask = nil
        removePhoto()
        result = nil
        adjustedCount = 0
        pendingMovement = nil
        errorMessage = nil
        phase = .camera
    }

    func prepare(for itemHint: String) {
        guard phase != .booking else { return }
        retake()
        self.itemHint = Self.limitItemHint(itemHint)
    }

    func apply(
        _ operation: StockCountOperation,
        to resource: InventoryResource,
        using client: APIClient,
        onSuccess: @escaping @MainActor (InventoryResource) -> Void
    ) {
        let count = adjustedCount
        guard result != nil, count > 0, !isBusy else { return }
        if operation == .issue, count > resource.quantity {
            errorMessage = "Es können höchstens \(resource.quantity) Einheiten entnommen werden."
            return
        }

        let movement: PendingMovement
        if let pendingMovement,
           pendingMovement.operation == operation,
           pendingMovement.count == count {
            movement = pendingMovement
        } else {
            movement = PendingMovement(id: UUID(), operation: operation, count: count)
            pendingMovement = movement
        }

        errorMessage = nil
        phase = .booking
        Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await client.bookStockMovement(
                    resourceID: resource.id,
                    delta: movement.operation.sign * movement.count,
                    type: movement.operation.stockType,
                    reason: movement.operation.reason,
                    location: resource.location,
                    idempotencyKey: movement.id
                )
                let updated = try await client.getResource(id: resource.id)
                pendingMovement = nil
                phase = .result
                onSuccess(updated)
            } catch {
                phase = .result
                errorMessage = error.localizedDescription
            }
        }
    }

    func cleanup() {
        analysisTask?.cancel()
        analysisTask = nil
        removePhoto()
    }

    private func analyzePreparedPhoto(using client: APIClient) async throws {
        guard let photoURL else {
            throw APIClientError.invalidUpload("Das Zählfoto fehlt.")
        }
        let response = try await client.countObjects(
            in: MediaUploadFile(fileURL: photoURL, filename: "count.jpg"),
            itemHint: itemHint
        )
        guard response.count >= 0 else {
            throw APIClientError.invalidResponse
        }
        result = response
        adjustedCount = response.count
        phase = .result
    }

    private func removePhoto() {
        if let photoURL {
            try? FileManager.default.removeItem(at: photoURL)
            self.photoURL = nil
        }
    }

    private static func makePhotoURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("inventory-stock-count-\(UUID().uuidString)")
            .appendingPathExtension("jpg")
    }

    private static func limitItemHint(_ value: String) -> String {
        guard value.utf16.count > maximumItemHintUTF16Length else { return value }
        var result = ""
        var length = 0
        for character in value {
            let next = String(character)
            let nextLength = next.utf16.count
            guard length + nextLength <= maximumItemHintUTF16Length else { break }
            result.append(character)
            length += nextLength
        }
        return result
    }
}

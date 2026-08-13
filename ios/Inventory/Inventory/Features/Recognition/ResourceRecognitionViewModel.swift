import Foundation
import SwiftUI

@MainActor
final class ResourceRecognitionViewModel: ObservableObject {
    enum Phase: Equatable {
        case camera
        case preparingPhoto
        case recognizing
        case result
    }

    @Published private(set) var phase: Phase = .camera
    @Published private(set) var photoURL: URL?
    @Published private(set) var result: InventoryRecognitionResponse?
    @Published var errorMessage: String?

    private let downsampler: JPEGDownsampler
    private var recognitionTask: Task<Void, Never>?
    private var activeTaskID: UUID?
    private var recognitionAttemptID: UUID?

    init() {
        downsampler = try! JPEGDownsampler(
            maximumPixelSize: 2_200,
            compressionQuality: 0.86
        )
        Self.removeStaleTemporaryPhotos()
    }

    var isBusy: Bool {
        phase == .preparingPhoto || phase == .recognizing
    }

    func recognizeCapturedData(
        _ data: Data,
        cropAspectRatio: CGFloat = CameraService.photoAspectRatio,
        using client: APIClient
    ) {
        guard !isBusy else { return }
        recognitionTask?.cancel()
        removePhoto()
        result = nil
        errorMessage = nil
        recognitionAttemptID = UUID()
        phase = .preparingPhoto

        let destination = Self.makePhotoURL()
        let taskID = UUID()
        activeTaskID = taskID
        recognitionTask = Task { [weak self] in
            guard let self else { return }
            do {
                let image = try await downsampler.downsample(
                    encodedImageData: data,
                    destinationURL: destination,
                    cropAspectRatio: cropAspectRatio
                )
                try Task.checkCancellation()
                guard activeTaskID == taskID else { throw CancellationError() }
                photoURL = image.fileURL
                phase = .recognizing
                try await recognizePreparedPhoto(using: client, taskID: taskID)
            } catch is CancellationError {
                guard activeTaskID == taskID else {
                    try? FileManager.default.removeItem(at: destination)
                    return
                }
                if photoURL == nil {
                    try? FileManager.default.removeItem(at: destination)
                    phase = .camera
                } else {
                    phase = .result
                }
            } catch {
                guard activeTaskID == taskID else {
                    try? FileManager.default.removeItem(at: destination)
                    return
                }
                rotateAttemptAfterServerFailure(error)
                if photoURL == nil {
                    try? FileManager.default.removeItem(at: destination)
                    phase = .camera
                } else {
                    phase = .result
                }
                errorMessage = error.localizedDescription
            }
            guard activeTaskID == taskID else { return }
            recognitionTask = nil
            activeTaskID = nil
        }
    }

    func retry(using client: APIClient) {
        guard photoURL != nil, !isBusy else { return }
        recognitionTask?.cancel()
        if recognitionAttemptID == nil { recognitionAttemptID = UUID() }
        result = nil
        errorMessage = nil
        phase = .recognizing
        let taskID = UUID()
        activeTaskID = taskID
        recognitionTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await recognizePreparedPhoto(using: client, taskID: taskID)
            } catch is CancellationError {
                guard activeTaskID == taskID else { return }
                phase = .result
            } catch {
                guard activeTaskID == taskID else { return }
                rotateAttemptAfterServerFailure(error)
                phase = .result
                errorMessage = error.localizedDescription
            }
            guard activeTaskID == taskID else { return }
            recognitionTask = nil
            activeTaskID = nil
        }
    }

    func retake() {
        let task = recognitionTask
        activeTaskID = nil
        recognitionTask = nil
        task?.cancel()
        recognitionAttemptID = nil
        removePhoto()
        result = nil
        errorMessage = nil
        phase = .camera
    }

    func cancel() {
        let wasBusy = isBusy
        let task = recognitionTask
        activeTaskID = nil
        recognitionTask = nil
        task?.cancel()
        if wasBusy {
            phase = photoURL == nil ? .camera : .result
        }
    }

    func cleanup() {
        let task = recognitionTask
        activeTaskID = nil
        recognitionTask = nil
        task?.cancel()
        recognitionAttemptID = nil
        removePhoto()
        result = nil
        errorMessage = nil
        phase = .camera
    }

    private func recognizePreparedPhoto(
        using client: APIClient,
        taskID: UUID
    ) async throws {
        guard let photoURL else {
            throw APIClientError.invalidUpload("Das Erkennungsfoto fehlt.")
        }
        let attemptID = recognitionAttemptID ?? UUID()
        recognitionAttemptID = attemptID
        let response = try await client.recognizeInventoryObject(
            in: MediaUploadFile(
                fileURL: photoURL,
                filename: "inventory-recognition.jpg",
                mimeType: "image/jpeg"
            ),
            idempotencyKey: attemptID
        )
        try Task.checkCancellation()
        guard activeTaskID == taskID else { throw CancellationError() }
        result = response
        phase = .result
    }

    private func rotateAttemptAfterServerFailure(_ error: Error) {
        guard let apiError = error as? APIClientError,
              apiError.isTerminal else { return }
        recognitionAttemptID = UUID()
    }

    private func removePhoto() {
        if let photoURL { try? FileManager.default.removeItem(at: photoURL) }
        photoURL = nil
    }

    private static func makePhotoURL() -> URL {
        let directory = temporaryPhotoDirectory
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")
    }

    private static var temporaryPhotoDirectory: URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("InventoryRecognition", isDirectory: true)
    }

    private static func removeStaleTemporaryPhotos() {
        let fileManager = FileManager.default
        let directory = temporaryPhotoDirectory
        guard let files = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        for file in files {
            let modifiedAt = try? file.resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate
            if let modifiedAt {
                if modifiedAt < cutoff {
                    try? fileManager.removeItem(at: file)
                }
            } else {
                try? fileManager.removeItem(at: file)
            }
        }
    }
}

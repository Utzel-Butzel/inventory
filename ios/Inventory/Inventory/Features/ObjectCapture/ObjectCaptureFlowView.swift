import Foundation
import ImageIO
import RealityKit
import SwiftUI

struct ObjectCaptureWorkspace: Equatable, Sendable {
    static let staleWorkspaceAge: TimeInterval = 24 * 60 * 60

    let id: UUID
    let rootURL: URL
    let imagesDirectory: URL
    let checkpointDirectory: URL
    let modelURL: URL
    let articleImageURL: URL

    static func create(
        in baseDirectory: URL? = nil,
        id: UUID = UUID(),
        fileManager: FileManager = .default,
        now: Date = Date()
    ) throws -> ObjectCaptureWorkspace {
        let base = baseDirectory ?? defaultBaseDirectory(fileManager: fileManager)
        let root = base.appendingPathComponent(id.uuidString, isDirectory: true)
        try fileManager.createDirectory(at: base, withIntermediateDirectories: true)
        removeStaleWorkspaces(
            in: base,
            olderThan: now.addingTimeInterval(-staleWorkspaceAge),
            excluding: root,
            fileManager: fileManager
        )
        let images = root.appendingPathComponent("Images", isDirectory: true)
        let checkpoints = root.appendingPathComponent("Checkpoints", isDirectory: true)

        try fileManager.createDirectory(at: images, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: checkpoints, withIntermediateDirectories: true)
        var rootForBackup = root
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try rootForBackup.setResourceValues(resourceValues)

        return ObjectCaptureWorkspace(
            id: id,
            rootURL: root,
            imagesDirectory: images,
            checkpointDirectory: checkpoints,
            modelURL: root.appendingPathComponent("object.usdz"),
            articleImageURL: root.appendingPathComponent("article-image.jpg")
        )
    }

    func remove(fileManager: FileManager = .default) throws {
        guard fileManager.fileExists(atPath: rootURL.path) else { return }
        try fileManager.removeItem(at: rootURL)
    }

    static func removeStaleWorkspaces(
        in baseDirectory: URL,
        olderThan cutoff: Date,
        excluding excludedURL: URL? = nil,
        fileManager: FileManager = .default
    ) {
        let children = (try? fileManager.contentsOfDirectory(
            at: baseDirectory,
            includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        for child in children where child.standardizedFileURL != excludedURL?.standardizedFileURL {
            let values = try? child.resourceValues(forKeys: [
                .isDirectoryKey,
                .contentModificationDateKey,
            ])
            guard values?.isDirectory == true,
                  let modifiedAt = values?.contentModificationDate,
                  modifiedAt < cutoff else { continue }
            try? fileManager.removeItem(at: child)
        }
    }

    private static func defaultBaseDirectory(fileManager: FileManager) -> URL {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Inventory", isDirectory: true)
            .appendingPathComponent("ObjectCaptures", isDirectory: true)
    }
}

struct CapturedObjectModel: Identifiable, Equatable, Sendable {
    static let mimeType = "model/vnd.usdz+zip"

    let id: UUID
    let fileURL: URL
    let articleImageURL: URL
    let workspaceURL: URL
    let shotCount: Int
    let byteCount: Int64
    let articleImageByteCount: Int64

    var uploadFile: MediaUploadFile {
        MediaUploadFile(
            fileURL: fileURL,
            filename: "object-\(id.uuidString.lowercased()).usdz",
            mimeType: Self.mimeType
        )
    }

    var articleImageUploadFile: MediaUploadFile {
        MediaUploadFile(
            fileURL: articleImageURL,
            filename: "object-\(id.uuidString.lowercased())-article.jpg",
            mimeType: "image/jpeg"
        )
    }

    /// Keep the representative image first so it becomes the resource cover
    /// immediately, even when the account cannot run AI post-processing.
    var uploadFiles: [MediaUploadFile] {
        [articleImageUploadFile, uploadFile]
    }

    func removeLocalFiles(fileManager: FileManager = .default) throws {
        guard fileManager.fileExists(atPath: workspaceURL.path) else { return }
        try fileManager.removeItem(at: workspaceURL)
    }
}

enum ObjectCaptureArticleImageError: Error, LocalizedError, Sendable {
    case noUsableCaptureImage

    var errorDescription: String? {
        switch self {
        case .noUsableCaptureImage:
            "Aus dem Objektscan konnte kein verwendbares Artikelbild erzeugt werden."
        }
    }
}

/// Builds a regular inventory JPEG from the Object Capture photo series before
/// those large source images are discarded. Work runs on its own actor so ImageIO
/// decoding never blocks SwiftUI's main actor.
actor ObjectCaptureArticleImageBuilder {
    private let maximumPixelSize: Int
    private let compressionQuality: Double

    init(
        maximumPixelSize: Int = ImageSizePreferences.defaultUploadPixelSize,
        compressionQuality: Double = 0.86
    ) {
        self.maximumPixelSize = maximumPixelSize
        self.compressionQuality = compressionQuality
    }

    func build(
        from imagesDirectory: URL,
        destinationURL: URL,
        fileManager: FileManager = .default
    ) async throws -> ProcessedJPEG {
        try Task.checkCancellation()
        let candidates = Self.imageCandidates(
            in: imagesDirectory,
            fileManager: fileManager
        )
        guard let sourceURL = Self.representativeImage(in: candidates) else {
            throw ObjectCaptureArticleImageError.noUsableCaptureImage
        }
        try Task.checkCancellation()
        let downsampler = try JPEGDownsampler(
            maximumPixelSize: maximumPixelSize,
            compressionQuality: compressionQuality
        )
        return try await downsampler.downsample(
            sourceURL: sourceURL,
            destinationURL: destinationURL
        )
    }

    /// Object Capture names its samples sequentially. A middle image is normally
    /// a clean, centered view and avoids setup/finish frames at either edge.
    static func representativeImage(in candidates: [URL]) -> URL? {
        let ordered = candidates.sorted {
            $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending
        }
        guard !ordered.isEmpty else { return nil }
        return ordered[(ordered.count - 1) / 2]
    }

    private static func imageCandidates(
        in directory: URL,
        fileManager: FileManager
    ) -> [URL] {
        let supportedExtensions = Set(["heic", "heif", "jpg", "jpeg", "png"])
        guard let enumerator = fileManager.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var candidates: [URL] = []
        for case let url as URL in enumerator {
            guard supportedExtensions.contains(url.pathExtension.lowercased()),
                  (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true,
                  let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  CGImageSourceGetCount(source) > 0 else { continue }
            candidates.append(url)
        }
        return candidates
    }
}

enum ObjectCaptureProgress {
    static func normalized(_ value: Double) -> Double {
        min(1, max(0, value.isFinite ? value : 0))
    }
}

@MainActor
enum ObjectCaptureAvailability {
    static var isSupported: Bool {
        ObjectCaptureSession.isSupported && PhotogrammetrySession.isSupported
    }

    static let requirement =
        "Objektscans benötigen ein LiDAR-fähiges iPhone Pro mit Unterstützung für Apple Object Capture."
}

private enum ObjectCaptureFlowPhase: Equatable {
    case preparing
    case ready
    case detecting
    case capturing
    case finishing
    case reconstructing
    case complete
    case failed
}

@MainActor
private final class ObjectCaptureFlowModel: ObservableObject {
    static let minimumManualFinishShots = 10

    @Published private(set) var session = ObjectCaptureSession()
    @Published private(set) var phase: ObjectCaptureFlowPhase = .preparing
    @Published private(set) var feedback: Set<ObjectCaptureSession.Feedback> = []
    @Published private(set) var shotCount = 0
    @Published private(set) var completedScanPass = false
    @Published private(set) var reconstructionProgress = 0.0
    @Published private(set) var reconstructionStage: String?
    @Published private(set) var estimatedRemainingTime: TimeInterval?
    @Published private(set) var warningMessage: String?
    @Published private(set) var errorMessage: String?
    @Published private(set) var result: CapturedObjectModel?

    private var workspace: ObjectCaptureWorkspace?
    private var captureTasks: [Task<Void, Never>] = []
    private var reconstructionTask: Task<Void, Never>?
    private var photogrammetrySession: PhotogrammetrySession?
    private let articleImageBuilder: ObjectCaptureArticleImageBuilder
    private var started = false
    private var reconstructionStarted = false
    private var resultPreparationStarted = false
    private var ownsWorkspace = true

    init(maximumUploadImagePixelSize: Int) {
        articleImageBuilder = ObjectCaptureArticleImageBuilder(
            maximumPixelSize: maximumUploadImagePixelSize
        )
    }

    var canRetryReconstruction: Bool {
        phase == .failed && workspace != nil && reconstructionStarted
    }

    var canFinishCapture: Bool {
        phase == .capturing && shotCount >= Self.minimumManualFinishShots
    }

    func startIfNeeded() {
        guard !started else { return }
        startFreshCapture()
    }

    func startDetecting() {
        guard phase == .ready else { return }
        guard session.startDetecting() else {
            fail(
                "Das Objekt konnte noch nicht ausgewählt werden. Richte die Kamera erneut auf den Gegenstand.",
                reconstructionCanRetry: false
            )
            return
        }
    }

    func resetDetection() {
        guard phase == .detecting else { return }
        if !session.resetDetection() {
            fail("Die Objektauswahl konnte nicht zurückgesetzt werden.", reconstructionCanRetry: false)
        }
    }

    func startCapturing() {
        guard phase == .detecting else { return }
        session.startCapturing()
    }

    func beginAnotherPass() {
        guard phase == .capturing, completedScanPass else { return }
        completedScanPass = false
        session.beginNewScanPass()
    }

    func beginPassAfterFlip() {
        guard phase == .capturing, completedScanPass else { return }
        completedScanPass = false
        session.beginNewScanPassAfterFlip()
    }

    func finishCapture() {
        guard phase == .capturing, shotCount > 0 else { return }
        phase = .finishing
        session.finish()
    }

    func retry() {
        guard phase == .failed else { return }
        if canRetryReconstruction {
            beginReconstruction(retry: true)
        } else {
            startFreshCapture()
        }
    }

    func transferResult() -> CapturedObjectModel? {
        guard let result else { return nil }
        ownsWorkspace = false
        stopCaptureWork()
        return result
    }

    func cancelAndCleanup() {
        stopCaptureWork()
        cleanupWorkspaceIfOwned()
    }

    private func startFreshCapture() {
        stopCaptureWork()
        cleanupWorkspaceIfOwned()

        session = ObjectCaptureSession()
        phase = .preparing
        feedback = []
        shotCount = 0
        completedScanPass = false
        reconstructionProgress = 0
        reconstructionStage = nil
        estimatedRemainingTime = nil
        warningMessage = nil
        errorMessage = nil
        result = nil
        workspace = nil
        started = true
        reconstructionStarted = false
        resultPreparationStarted = false
        ownsWorkspace = true

        do {
            let workspace = try ObjectCaptureWorkspace.create()
            self.workspace = workspace
            observeCaptureSession(session)

            var configuration = ObjectCaptureSession.Configuration()
            configuration.checkpointDirectory = workspace.checkpointDirectory
            configuration.isOverCaptureEnabled = false
            session.start(
                imagesDirectory: workspace.imagesDirectory,
                configuration: configuration
            )
        } catch {
            fail(
                "Der lokale Speicher für den Objektscan konnte nicht vorbereitet werden: \(error.localizedDescription)",
                reconstructionCanRetry: false
            )
        }
    }

    private func observeCaptureSession(_ observedSession: ObjectCaptureSession) {
        captureTasks = [
            Task { [weak self] in
                for await state in observedSession.stateUpdates {
                    guard !Task.isCancelled else { return }
                    self?.handleCaptureState(state, from: observedSession)
                }
            },
            Task { [weak self] in
                for await feedback in observedSession.feedbackUpdates {
                    guard !Task.isCancelled else { return }
                    guard self?.session === observedSession else { return }
                    self?.feedback = feedback
                }
            },
            Task { [weak self] in
                for await count in observedSession.numberOfShotsTakenUpdates {
                    guard !Task.isCancelled else { return }
                    guard self?.session === observedSession else { return }
                    self?.shotCount = count
                }
            },
            Task { [weak self] in
                for await completed in observedSession.userCompletedScanPassUpdates {
                    guard !Task.isCancelled else { return }
                    guard self?.session === observedSession else { return }
                    self?.completedScanPass = completed
                }
            },
        ]
    }

    private func handleCaptureState(
        _ state: ObjectCaptureSession.CaptureState,
        from observedSession: ObjectCaptureSession
    ) {
        guard session === observedSession else { return }
        switch state {
        case .initializing:
            phase = .preparing
        case .ready:
            phase = .ready
        case .detecting:
            phase = .detecting
        case .capturing:
            phase = .capturing
        case .finishing:
            phase = .finishing
        case .completed:
            beginReconstruction(retry: false)
        case .failed(let error):
            fail(error.localizedDescription, reconstructionCanRetry: false)
        @unknown default:
            warningMessage = "Die aktuelle iOS-Version meldet einen unbekannten Scanstatus."
        }
    }

    private func beginReconstruction(retry: Bool) {
        guard let workspace else {
            fail("Die Aufnahmedaten des Objekts fehlen.", reconstructionCanRetry: false)
            return
        }
        guard retry || !reconstructionStarted else { return }

        reconstructionTask?.cancel()
        photogrammetrySession?.cancel()
        try? FileManager.default.removeItem(at: workspace.modelURL)
        reconstructionStarted = true
        phase = .reconstructing
        reconstructionProgress = 0
        reconstructionStage = "Aufnahmen werden vorbereitet"
        estimatedRemainingTime = nil
        warningMessage = nil
        errorMessage = nil

        do {
            var configuration = PhotogrammetrySession.Configuration()
            configuration.checkpointDirectory = workspace.checkpointDirectory
            let photogrammetrySession = try PhotogrammetrySession(
                input: workspace.imagesDirectory,
                configuration: configuration
            )
            self.photogrammetrySession = photogrammetrySession
            let request = PhotogrammetrySession.Request.modelFile(
                url: workspace.modelURL,
                detail: .reduced
            )
            try photogrammetrySession.process(requests: [request])

            reconstructionTask = Task { [weak self] in
                do {
                    for try await output in photogrammetrySession.outputs {
                        guard !Task.isCancelled else { return }
                        self?.handleReconstructionOutput(
                            output,
                            request: request,
                            workspace: workspace
                        )
                    }
                } catch is CancellationError {
                    return
                } catch {
                    self?.fail(error.localizedDescription, reconstructionCanRetry: true)
                }
            }
        } catch {
            fail(error.localizedDescription, reconstructionCanRetry: true)
        }
    }

    private func handleReconstructionOutput(
        _ output: PhotogrammetrySession.Output,
        request: PhotogrammetrySession.Request,
        workspace: ObjectCaptureWorkspace
    ) {
        switch output {
        case .requestProgress(let outputRequest, let fractionComplete)
            where outputRequest == request:
            reconstructionProgress = ObjectCaptureProgress.normalized(fractionComplete)
        case .requestProgressInfo(let outputRequest, let info)
            where outputRequest == request:
            estimatedRemainingTime = info.estimatedRemainingTime
            reconstructionStage = info.processingStage.map(Self.label(for:))
        case .requestComplete(let outputRequest, let outputResult)
            where outputRequest == request:
            guard case .modelFile(let modelURL) = outputResult else { return }
            completeModel(at: modelURL, workspace: workspace)
        case .requestError(let outputRequest, let error) where outputRequest == request:
            fail(error.localizedDescription, reconstructionCanRetry: true)
        case .processingComplete:
            if phase == .reconstructing,
               FileManager.default.fileExists(atPath: workspace.modelURL.path) {
                completeModel(at: workspace.modelURL, workspace: workspace)
            }
        case .stitchingIncomplete:
            warningMessage =
                "Einige Aufnahmen konnten nicht vollständig verbunden werden. Prüfe das Modell nach dem Upload."
        case .automaticDownsampling:
            warningMessage =
                "Die Aufnahmen wurden für die Verarbeitung auf diesem iPhone automatisch verkleinert."
        case .invalidSample(_, let reason):
            warningMessage = "Mindestens eine Aufnahme wurde übersprungen: \(reason)"
        case .skippedSample:
            warningMessage = "Mindestens eine Aufnahme konnte nicht für das Modell verwendet werden."
        case .processingCancelled:
            fail("Die Erstellung des 3D-Modells wurde unerwartet abgebrochen.", reconstructionCanRetry: true)
        case .inputComplete, .requestProgress,
             .requestProgressInfo, .requestComplete, .requestError:
            break
        @unknown default:
            break
        }
    }

    private func completeModel(at modelURL: URL, workspace: ObjectCaptureWorkspace) {
        guard phase == .reconstructing else { return }
        let values = try? modelURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values?.isRegularFile == true, let size = values?.fileSize, size > 0 else {
            fail("Das rekonstruierte USDZ-Modell fehlt oder ist leer.", reconstructionCanRetry: true)
            return
        }

        guard !resultPreparationStarted else { return }
        resultPreparationStarted = true
        reconstructionProgress = 1
        reconstructionStage = "Artikelbild wird vorbereitet"
        estimatedRemainingTime = nil
        reconstructionTask = Task { [weak self] in
            guard let self else { return }
            do {
                let articleImage = try await articleImageBuilder.build(
                    from: workspace.imagesDirectory,
                    destinationURL: workspace.articleImageURL
                )
                try Task.checkCancellation()
                result = CapturedObjectModel(
                    id: workspace.id,
                    fileURL: modelURL,
                    articleImageURL: articleImage.fileURL,
                    workspaceURL: workspace.rootURL,
                    shotCount: shotCount,
                    byteCount: Int64(size),
                    articleImageByteCount: articleImage.byteCount
                )
                try? FileManager.default.removeItem(at: workspace.imagesDirectory)
                try? FileManager.default.removeItem(at: workspace.checkpointDirectory)
                phase = .complete
                photogrammetrySession = nil
                reconstructionTask = nil
            } catch is CancellationError {
                return
            } catch {
                resultPreparationStarted = false
                fail(error.localizedDescription, reconstructionCanRetry: true)
            }
        }
    }

    private func fail(_ message: String, reconstructionCanRetry: Bool) {
        errorMessage = message.isEmpty ? "Der Objektscan ist fehlgeschlagen." : message
        phase = .failed
        if !reconstructionCanRetry {
            reconstructionStarted = false
        }
    }

    private func stopCaptureWork() {
        captureTasks.forEach { $0.cancel() }
        captureTasks = []
        reconstructionTask?.cancel()
        reconstructionTask = nil
        photogrammetrySession?.cancel()
        photogrammetrySession = nil
        session.cancel()
    }

    private func cleanupWorkspaceIfOwned() {
        guard ownsWorkspace, let workspace else { return }
        try? workspace.remove()
        self.workspace = nil
    }

    private static func label(
        for stage: PhotogrammetrySession.Output.ProcessingStage
    ) -> String {
        switch stage {
        case .preProcessing: "Aufnahmen werden vorbereitet"
        case .imageAlignment: "Aufnahmen werden ausgerichtet"
        case .pointCloudGeneration: "Punktwolke wird berechnet"
        case .meshGeneration: "3D-Geometrie wird erstellt"
        case .textureMapping: "Texturen werden erzeugt"
        case .optimization: "Modell wird optimiert"
        @unknown default: "3D-Modell wird erstellt"
        }
    }

    static func feedbackMessage(
        for feedback: Set<ObjectCaptureSession.Feedback>
    ) -> String? {
        if feedback.contains(.environmentTooDark) {
            return "Es ist zu dunkel. Sorge für helles, diffuses Licht."
        }
        if feedback.contains(.environmentLowLight) {
            return "Mehr Licht verbessert Farbe und Modellqualität."
        }
        if feedback.contains(.movingTooFast) {
            return "Bewege das iPhone langsamer und gleichmäßiger."
        }
        if feedback.contains(.objectTooClose) {
            return "Gehe etwas weiter vom Objekt weg."
        }
        if feedback.contains(.objectTooFar) {
            return "Gehe etwas näher an das Objekt heran."
        }
        if feedback.contains(.outOfFieldOfView) {
            return "Halte das gesamte Objekt im Bild."
        }
        if #available(iOS 17.4, *), feedback.contains(.objectNotDetected) {
            return "Das Objekt wird nicht erkannt. Richte die Kamera erneut darauf."
        }
        if feedback.contains(.overCapturing) {
            return "Dieser Bereich ist bereits ausreichend aufgenommen."
        }
        if feedback.contains(.objectNotFlippable) {
            return "Dieses Objekt sollte nicht gewendet werden. Nimm weitere Höhen auf."
        }
        return nil
    }
}

struct ObjectCaptureFlowView: View {
    @Environment(\.dismiss) private var dismiss

    let maximumUploadImagePixelSize: Int
    let onComplete: (CapturedObjectModel) -> Void
    let onFallback: () -> Void

    var body: some View {
        Group {
            if ObjectCaptureAvailability.isSupported {
                SupportedObjectCaptureFlowView(
                    maximumUploadImagePixelSize: maximumUploadImagePixelSize,
                    onComplete: onComplete
                )
            } else {
                unsupportedView
            }
        }
        .tint(InventoryTheme.accent)
    }

    private var unsupportedView: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("3D-Objektscan nicht verfügbar", systemImage: "cube.transparent")
            } description: {
                Text(ObjectCaptureAvailability.requirement)
            } actions: {
                Button("Eintrag ohne 3D-Modell anlegen") {
                    onFallback()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)

                Button("Schließen", role: .cancel) { dismiss() }
                    .buttonStyle(.bordered)
            }
            .navigationTitle("3D-Objektscan")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct SupportedObjectCaptureFlowView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ObjectCaptureFlowModel
    @State private var confirmCancellation = false
    @State private var deliveredResult = false

    let onComplete: (CapturedObjectModel) -> Void

    init(
        maximumUploadImagePixelSize: Int,
        onComplete: @escaping (CapturedObjectModel) -> Void
    ) {
        _model = StateObject(
            wrappedValue: ObjectCaptureFlowModel(
                maximumUploadImagePixelSize: maximumUploadImagePixelSize
            )
        )
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            captureContent
            LinearGradient(
                colors: [.black.opacity(0.55), .clear, .black.opacity(0.7)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            VStack(spacing: 14) {
                topBar
                Spacer()
                statusCard
                actionPanel
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
        }
        .background(.black)
        .ignoresSafeArea()
        .statusBarHidden()
        .task { model.startIfNeeded() }
        .onDisappear {
            if !deliveredResult {
                model.cancelAndCleanup()
            }
        }
        .confirmationDialog(
            "Objektscan abbrechen?",
            isPresented: $confirmCancellation,
            titleVisibility: .visible
        ) {
            Button("Scan verwerfen", role: .destructive) {
                model.cancelAndCleanup()
                dismiss()
            }
            Button("Weiter scannen", role: .cancel) { }
        } message: {
            Text("Die lokalen Aufnahmen und das noch nicht gespeicherte 3D-Modell werden gelöscht.")
        }
    }

    @ViewBuilder
    private var captureContent: some View {
        switch model.phase {
        case .preparing, .ready, .detecting, .capturing, .finishing:
            if model.completedScanPass, model.phase == .capturing {
                ObjectCapturePointCloudView(session: model.session)
            } else {
                ObjectCaptureView(session: model.session)
            }
        case .reconstructing:
            reconstructionBackdrop
        case .complete:
            completionBackdrop
        case .failed:
            Color.black
        }
    }

    private var reconstructionBackdrop: some View {
        ZStack {
            Color.black
            Image(systemName: "cube.transparent")
                .font(.system(size: 120, weight: .ultraLight))
                .foregroundStyle(InventoryTheme.lime.opacity(0.24))
        }
    }

    private var completionBackdrop: some View {
        ZStack {
            Color.black
            Image(systemName: "cube.fill")
                .font(.system(size: 118, weight: .light))
                .foregroundStyle(InventoryTheme.lime.opacity(0.8))
                .shadow(color: InventoryTheme.lime.opacity(0.35), radius: 28)
        }
    }

    private var topBar: some View {
        HStack {
            Button {
                confirmCancellation = true
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.5), in: Circle())
            }
            .foregroundStyle(.white)
            .accessibilityLabel("Objektscan abbrechen")

            Spacer()

            Label("3D-Objektscan", systemImage: "cube.transparent")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 42)
                .background(.black.opacity(0.5), in: Capsule())

            Spacer()

            Color.clear.frame(width: 44, height: 44)
        }
    }

    private var statusCard: some View {
        VStack(spacing: 8) {
            Text(statusTitle)
                .font(.headline)
                .multilineTextAlignment(.center)
            Text(statusMessage)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.82))

            if model.phase == .capturing {
                Text("\(model.shotCount) Aufnahmen")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(InventoryTheme.lime)
            }

            if model.phase == .reconstructing {
                ProgressView(value: model.reconstructionProgress)
                    .tint(InventoryTheme.lime)
                HStack {
                    Text(model.reconstructionStage ?? "3D-Modell wird erstellt")
                    Spacer()
                    Text(model.reconstructionProgress, format: .percent.precision(.fractionLength(0)))
                        .monospacedDigit()
                }
                .font(.caption)
                .foregroundStyle(.white.opacity(0.78))
                if let remaining = model.estimatedRemainingTime, remaining.isFinite, remaining > 1 {
                    Text("Noch ungefähr \(remainingTimeDescription(remaining))")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.7))
                }
            }

            if let warning = model.warningMessage {
                Label(warning, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.yellow)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .foregroundStyle(.white)
        .background(.black.opacity(0.64), in: RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder
    private var actionPanel: some View {
        switch model.phase {
        case .preparing:
            ProgressView().tint(.white).controlSize(.large)
        case .ready:
            primaryButton("Objekt auswählen", systemImage: "viewfinder") {
                model.startDetecting()
            }
        case .detecting:
            HStack(spacing: 10) {
                Button("Neu ausrichten") { model.resetDetection() }
                    .buttonStyle(.bordered)
                    .tint(.white)
                primaryButton("Scan starten", systemImage: "camera.fill") {
                    model.startCapturing()
                }
            }
        case .capturing where model.completedScanPass:
            VStack(spacing: 10) {
                primaryButton("3D-Modell erstellen", systemImage: "cube.fill") {
                    model.finishCapture()
                }
                HStack(spacing: 10) {
                    Button("Weitere Höhe") { model.beginAnotherPass() }
                        .buttonStyle(.bordered)
                    Button("Objekt wenden") { model.beginPassAfterFlip() }
                        .buttonStyle(.bordered)
                }
                .tint(.white)
            }
        case .capturing:
            VStack(spacing: 10) {
                Text("Fülle den Kreis, indem du das Objekt langsam umrundest.")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(.black.opacity(0.5), in: Capsule())
                if model.canFinishCapture {
                    Button("Aufnahme beenden") { model.finishCapture() }
                        .buttonStyle(.bordered)
                        .tint(.white)
                        .accessibilityHint(
                            "Beendet den Scan vor einem vollständig gefüllten Aufnahmekreis"
                        )
                }
            }
        case .finishing:
            ProgressView("Aufnahmen werden gesichert …")
                .tint(.white)
                .foregroundStyle(.white)
        case .reconstructing:
            EmptyView()
        case .complete:
            primaryButton("Weiter zu den Details", systemImage: "arrow.right") {
                guard let result = model.transferResult() else { return }
                deliveredResult = true
                onComplete(result)
                dismiss()
            }
        case .failed:
            VStack(spacing: 10) {
                primaryButton(
                    model.canRetryReconstruction ? "Modell erneut erstellen" : "Scan neu starten",
                    systemImage: "arrow.clockwise"
                ) {
                    model.retry()
                }
                Button("Schließen", role: .cancel) {
                    model.cancelAndCleanup()
                    dismiss()
                }
                .buttonStyle(.bordered)
                .tint(.white)
            }
        }
    }

    private func primaryButton(
        _ title: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.borderedProminent)
        .tint(InventoryTheme.lime)
        .foregroundStyle(InventoryTheme.ink)
    }

    private func remainingTimeDescription(_ interval: TimeInterval) -> String {
        let seconds = max(1, Int(interval.rounded(.up)))
        let minutes = seconds / 60
        let remainder = seconds % 60
        if minutes == 0 {
            return "\(remainder) Sek."
        }
        if remainder == 0 {
            return "\(minutes) Min."
        }
        return "\(minutes) Min. \(remainder) Sek."
    }

    private var statusTitle: String {
        switch model.phase {
        case .preparing: "Objektscan wird vorbereitet"
        case .ready: "Objekt mittig ausrichten"
        case .detecting: "Auswahl prüfen"
        case .capturing where model.completedScanPass: "Scanrunde abgeschlossen"
        case .capturing: "Langsam um das Objekt gehen"
        case .finishing: "Aufnahmen werden abgeschlossen"
        case .reconstructing: "3D-Modell wird erstellt"
        case .complete: "3D-Modell ist bereit"
        case .failed: "Objektscan fehlgeschlagen"
        }
    }

    private var statusMessage: String {
        switch model.phase {
        case .preparing:
            "Kamera und lokaler Speicher werden vorbereitet."
        case .ready:
            "Der Gegenstand sollte vollständig sichtbar sein und gleichmäßig beleuchtet werden."
        case .detecting:
            "Passe den eingeblendeten Rahmen an, bis nur der Gegenstand erfasst wird."
        case .capturing where model.completedScanPass:
            "Erstelle jetzt das Modell oder erfasse weitere Ansichten für ein vollständigeres Ergebnis."
        case .capturing:
            ObjectCaptureFlowModel.feedbackMessage(for: model.feedback)
                ?? "Halte das Objekt vollständig im Bild und bewege dich gleichmäßig."
        case .finishing:
            "Bitte die App geöffnet lassen, bis alle Sensordaten gespeichert sind."
        case .reconstructing:
            "Die Verarbeitung läuft vollständig auf diesem iPhone und kann einige Minuten dauern."
        case .complete:
            "Ergänze im nächsten Schritt Namen und Inventardaten; das USDZ-Modell wird anschließend hochgeladen."
        case .failed:
            model.errorMessage ?? "Der Scan konnte nicht abgeschlossen werden."
        }
    }
}

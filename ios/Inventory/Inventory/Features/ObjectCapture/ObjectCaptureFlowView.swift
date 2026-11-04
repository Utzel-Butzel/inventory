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
            L10n.text("ui_could_not_generate_a_usable_item_image_02514e9b")
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
        L10n.text("ui_object_scans_require_a_lidar_equipped_iphone_3fa75682")
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
                L10n.text("ui_the_object_could_not_be_selected_yet_01f931b6"),
                reconstructionCanRetry: false
            )
            return
        }
    }

    func resetDetection() {
        guard phase == .detecting else { return }
        if !session.resetDetection() {
            fail(L10n.text("ui_could_not_reset_the_object_selection_3673cf24"), reconstructionCanRetry: false)
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
                L10n.text("ui_could_not_prepare_local_storage_for_the_8d126860", error.localizedDescription),
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
            warningMessage = L10n.text("ui_the_current_ios_version_reports_an_unknown_67fc072e")
        }
    }

    private func beginReconstruction(retry: Bool) {
        guard let workspace else {
            fail(L10n.text("ui_the_object_s_capture_data_is_missing_6e2aa263"), reconstructionCanRetry: false)
            return
        }
        guard retry || !reconstructionStarted else { return }

        reconstructionTask?.cancel()
        photogrammetrySession?.cancel()
        try? FileManager.default.removeItem(at: workspace.modelURL)
        reconstructionStarted = true
        phase = .reconstructing
        reconstructionProgress = 0
        reconstructionStage = L10n.text("ui_preparing_captures_ba546656")
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
                L10n.text("ui_some_captures_could_not_be_fully_aligned_e7113ed7")
        case .automaticDownsampling:
            warningMessage =
                L10n.text("ui_the_captures_were_automatically_downsized_for_processing_6b47a1cd")
        case .invalidSample(_, let reason):
            warningMessage = L10n.text("ui_at_least_one_capture_was_skipped_0_3b6ee857", reason)
        case .skippedSample:
            warningMessage = L10n.text("ui_at_least_one_capture_could_not_be_22baf723")
        case .processingCancelled:
            fail(L10n.text("ui_3d_model_creation_was_cancelled_unexpectedly_e67b0092"), reconstructionCanRetry: true)
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
            fail(L10n.text("ui_the_reconstructed_usdz_model_is_missing_or_f9aee403"), reconstructionCanRetry: true)
            return
        }

        guard !resultPreparationStarted else { return }
        resultPreparationStarted = true
        reconstructionProgress = 1
        reconstructionStage = L10n.text("ui_preparing_item_image_853e7bcd")
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
        errorMessage = message.isEmpty ? L10n.text("ui_the_object_scan_failed_1a7b4fa0") : message
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
        case .preProcessing: L10n.text("ui_preparing_captures_ba546656")
        case .imageAlignment: L10n.text("ui_aligning_captures_f612ca9a")
        case .pointCloudGeneration: L10n.text("ui_calculating_point_cloud_da75bd13")
        case .meshGeneration: L10n.text("ui_creating_3d_geometry_5a016c92")
        case .textureMapping: L10n.text("ui_generating_textures_27fd010d")
        case .optimization: L10n.text("ui_optimizing_model_a6d7c5b6")
        @unknown default: L10n.text("ui_creating_3d_model_b6871a36")
        }
    }

    static func feedbackMessage(
        for feedback: Set<ObjectCaptureSession.Feedback>
    ) -> String? {
        if feedback.contains(.environmentTooDark) {
            return L10n.text("ui_it_is_too_dark_provide_bright_diffuse_3c78ddee")
        }
        if feedback.contains(.environmentLowLight) {
            return L10n.text("ui_more_light_improves_color_and_model_quality_c6577eba")
        }
        if feedback.contains(.movingTooFast) {
            return L10n.text("ui_move_the_iphone_more_slowly_and_steadily_c49678aa")
        }
        if feedback.contains(.objectTooClose) {
            return L10n.text("ui_move_a_little_further_from_the_object_54172e90")
        }
        if feedback.contains(.objectTooFar) {
            return L10n.text("ui_move_a_little_closer_to_the_object_42e3ff45")
        }
        if feedback.contains(.outOfFieldOfView) {
            return L10n.text("ui_keep_the_entire_object_in_view_830a8127")
        }
        if #available(iOS 17.4, *), feedback.contains(.objectNotDetected) {
            return L10n.text("ui_the_object_is_not_detected_point_the_6130b73f")
        }
        if feedback.contains(.overCapturing) {
            return L10n.text("ui_this_area_has_already_been_captured_sufficiently_8fbbd1a4")
        }
        if feedback.contains(.objectNotFlippable) {
            return L10n.text("ui_this_object_should_not_be_flipped_capture_d5a58d74")
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
                Label(L10n.text("ui_3d_object_scanning_unavailable_abcc0687"), systemImage: "cube.transparent")
            } description: {
                Text(ObjectCaptureAvailability.requirement)
            } actions: {
                Button(L10n.text("ui_create_item_without_3d_model_8b94f6ba")) {
                    onFallback()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)

                Button(L10n.text("ui_close_b808f6e9"), role: .cancel) { dismiss() }
                    .buttonStyle(.bordered)
            }
            .navigationTitle(L10n.text("ui_object_scan_3d"))
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
            L10n.text("ui_cancel_object_scan_a39ae7b1"),
            isPresented: $confirmCancellation,
            titleVisibility: .visible
        ) {
            Button(L10n.text("ui_discard_scan_88cca0cc"), role: .destructive) {
                model.cancelAndCleanup()
                dismiss()
            }
            Button(L10n.text("ui_continue_scanning_3402ece8"), role: .cancel) { }
        } message: {
            Text(L10n.text("ui_the_local_captures_and_unsaved_3d_model_dcc1b500"))
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
            .accessibilityLabel(L10n.text("ui_cancel_object_scan_9dc6f4e1"))

            Spacer()

            Label(L10n.text("ui_object_scan_3d"), systemImage: "cube.transparent")
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
                Text(L10n.text("ui_captures_0_87cd1f1d", model.shotCount))
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(InventoryTheme.lime)
            }

            if model.phase == .reconstructing {
                ProgressView(value: model.reconstructionProgress)
                    .tint(InventoryTheme.lime)
                HStack {
                    Text(model.reconstructionStage ?? L10n.text("ui_creating_3d_model_b6871a36"))
                    Spacer()
                    Text(model.reconstructionProgress, format: .percent.precision(.fractionLength(0)))
                        .monospacedDigit()
                }
                .font(.caption)
                .foregroundStyle(.white.opacity(0.78))
                if let remaining = model.estimatedRemainingTime, remaining.isFinite, remaining > 1 {
                    Text(L10n.text("ui_about_0_remaining_e64f02e4", remainingTimeDescription(remaining)))
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
            primaryButton(L10n.text("ui_select_object_e9645b81"), systemImage: "viewfinder") {
                model.startDetecting()
            }
        case .detecting:
            HStack(spacing: 10) {
                Button(L10n.text("ui_realign_39c73e26")) { model.resetDetection() }
                    .buttonStyle(.bordered)
                    .tint(.white)
                primaryButton(L10n.text("ui_start_scan_329ac519"), systemImage: "camera.fill") {
                    model.startCapturing()
                }
            }
        case .capturing where model.completedScanPass:
            VStack(spacing: 10) {
                primaryButton(L10n.text("ui_create_3d_model_ba850f71"), systemImage: "cube.fill") {
                    model.finishCapture()
                }
                HStack(spacing: 10) {
                    Button(L10n.text("ui_another_height_da002898")) { model.beginAnotherPass() }
                        .buttonStyle(.bordered)
                    Button(L10n.text("ui_flip_object_a6e27ea6")) { model.beginPassAfterFlip() }
                        .buttonStyle(.bordered)
                }
                .tint(.white)
            }
        case .capturing:
            VStack(spacing: 10) {
                Text(L10n.text("ui_fill_the_circle_by_slowly_walking_around_fb11db9e"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(.black.opacity(0.5), in: Capsule())
                if model.canFinishCapture {
                    Button(L10n.text("ui_finish_capture_aae1061b")) { model.finishCapture() }
                        .buttonStyle(.bordered)
                        .tint(.white)
                        .accessibilityHint(
                            L10n.text("ui_ends_the_scan_before_the_capture_circle_49d86599")
                        )
                }
            }
        case .finishing:
            ProgressView(L10n.text("ui_saving_captures_e3591e4e"))
                .tint(.white)
                .foregroundStyle(.white)
        case .reconstructing:
            EmptyView()
        case .complete:
            primaryButton(L10n.text("ui_continue_to_details_2f321b84"), systemImage: "arrow.right") {
                guard let result = model.transferResult() else { return }
                deliveredResult = true
                onComplete(result)
                dismiss()
            }
        case .failed:
            VStack(spacing: 10) {
                primaryButton(
                    model.canRetryReconstruction ? L10n.text("ui_rebuild_model_57f231d9") : L10n.text("ui_restart_scan_7aa3a49f"),
                    systemImage: "arrow.clockwise"
                ) {
                    model.retry()
                }
                Button(L10n.text("ui_close_b808f6e9"), role: .cancel) {
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
            return L10n.text("ui_0_sec_44d798ce", remainder)
        }
        if remainder == 0 {
            return L10n.text("ui_0_min_f7744b09", minutes)
        }
        return L10n.text("ui_0_min_1_sec_2b68fd4c", minutes, remainder)
    }

    private var statusTitle: String {
        switch model.phase {
        case .preparing: L10n.text("ui_preparing_object_scan_a77f6e12")
        case .ready: L10n.text("ui_center_the_object_d427c999")
        case .detecting: L10n.text("ui_review_selection_f4773ba0")
        case .capturing where model.completedScanPass: L10n.text("ui_scan_pass_completed_00624e96")
        case .capturing: L10n.text("ui_walk_slowly_around_the_object_c68a6f52")
        case .finishing: L10n.text("ui_finishing_captures_c06d22c7")
        case .reconstructing: L10n.text("ui_creating_3d_model_b6871a36")
        case .complete: L10n.text("ui_3d_model_is_ready_2521322a")
        case .failed: L10n.text("ui_object_scan_failed_38e1067e")
        }
    }

    private var statusMessage: String {
        switch model.phase {
        case .preparing:
            L10n.text("ui_preparing_camera_and_local_storage_9398d1b9")
        case .ready:
            L10n.text("ui_the_item_should_be_fully_visible_and_fb60e6d6")
        case .detecting:
            L10n.text("ui_adjust_the_displayed_frame_until_only_the_8048688f")
        case .capturing where model.completedScanPass:
            L10n.text("ui_create_the_model_now_or_capture_additional_b6a08656")
        case .capturing:
            ObjectCaptureFlowModel.feedbackMessage(for: model.feedback)
                ?? L10n.text("ui_keep_the_entire_object_in_view_and_0004816f")
        case .finishing:
            L10n.text("ui_please_keep_the_app_open_until_all_1a56040e")
        case .reconstructing:
            L10n.text("ui_processing_runs_entirely_on_this_iphone_and_869fb199")
        case .complete:
            L10n.text("ui_add_the_name_and_inventory_details_in_3ade76f2")
        case .failed:
            model.errorMessage ?? L10n.text("ui_could_not_complete_the_scan_f0138b67")
        }
    }
}

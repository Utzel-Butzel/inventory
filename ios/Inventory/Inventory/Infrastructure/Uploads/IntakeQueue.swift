import Foundation

private enum IntakeQueuePersistenceError: Error, LocalizedError {
    case unableToPersist

    var errorDescription: String? {
        L10n.text("ui_could_not_persist_upload_status_on_the_a491be88")
    }
}

enum IntakeJobStage: String, Codable, Sendable {
    case preparing
    case queued
    case creating
    case placing
    case uploading
    case analyzing
    case researching
    case generatingCover
    case complete
    case warning
    case failed

    var isTerminal: Bool {
        self == .complete || self == .warning || self == .failed
    }
}

struct IntakeJob: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    let createdAt: Date
    var request: ResourceCreateRequest
    var filenames: [String]
    var mediaMIMETypes: [String]? = nil
    var mediaOriginalNames: [String]? = nil
    var sourceFilePaths: [String]?
    var expectedFileCount: Int?
    var serverOrigin: String?
    var organizationID: UUID?
    var principalIdentifier: String?
    var shouldAnalyze: Bool
    var shouldGenerateCover: Bool
    var imageModelID: String?
    var stage: IntakeJobStage
    var progress: Double
    var resourceID: UUID?
    var resourceName: String?
    var mediaUploaded: Bool
    var analysisCompleted: Bool
    var coverCompleted: Bool
    var analysisOperationID: UUID?
    var coverOperationID: UUID?
    var maximumAIGeneratedImagePixelSize: Int? = nil
    var shouldResearch: Bool? = nil
    var researchCompleted: Bool? = nil
    var researchOperationID: UUID? = nil
    var analysisOverwrite: Bool? = nil
    var analysisPrompt: String? = nil
    var coverPrompt: String? = nil
    var spatialPlacement: SpatialPlacementDraft? = nil
    var placementCompleted: Bool? = nil
    var placementWarning: String? = nil
    var attemptCount: Int?
    var nextAttemptAt: Date?
    var message: String?
}

@MainActor
final class IntakeQueue: ObservableObject {
    @Published private(set) var jobs: [IntakeJob] = []
    @Published private(set) var storageError: String?
    @Published private(set) var activeContextIdentifier: String?
    @Published private(set) var canProcessJobs = false

    private var client: APIClient?
    private var worker: Task<Void, Never>?
    private var configurationID = UUID()
    private let rootURL: URL
    private let manifestURL: URL
    private let manifestBackupURL: URL

    init() {
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        rootURL = applicationSupport
            .appendingPathComponent("Inventory", isDirectory: true)
            .appendingPathComponent("Outbox", isDirectory: true)
        manifestURL = rootURL.appendingPathComponent("jobs.json")
        manifestBackupURL = rootURL.appendingPathComponent("jobs.backup.json")
        do {
            try FileManager.default.createDirectory(
                at: rootURL,
                withIntermediateDirectories: true
            )
        } catch {
            storageError = L10n.text("ui_could_not_open_upload_storage_0_5d168a93", error.localizedDescription)
        }
        let loaded = Self.loadManifest(from: manifestURL, backupURL: manifestBackupURL)
        jobs = loaded.jobs
            .map { Self.recover($0, rootURL: rootURL) }
            .sorted { $0.createdAt > $1.createdAt }
        if let error = loaded.error {
            storageError = error
        } else {
            persist()
        }
    }

    deinit { worker?.cancel() }

    var visibleJobs: [IntakeJob] {
        guard let client,
              let principalIdentifier = client.principalIdentifier else { return [] }
        return Self.jobs(
            jobs,
            matchingServerOrigin: client.serverURL.absoluteString,
            organizationID: client.organizationID,
            principalIdentifier: principalIdentifier
        )
    }

    func configure(client: APIClient?, canWrite: Bool = false) {
        configurationID = UUID()
        worker?.cancel()
        worker = nil
        self.client = client
        canProcessJobs = client != nil && canWrite
        activeContextIdentifier = client?.contextIdentifier
        if client != nil {
            Task { [weak self] in
                await self?.resumePreparingJobs()
            }
        }
        startWorkerIfNeeded()
    }

    func enqueue(_ submission: IntakeSubmission) {
        guard canProcessJobs, client?.principalIdentifier != nil else { return }
        var job = IntakeJob(
            id: submission.id,
            createdAt: Date(),
            request: submission.request,
            filenames: [],
            mediaMIMETypes: submission.photos.map(\.mimeType),
            mediaOriginalNames: submission.photos.map(\.filename),
            sourceFilePaths: submission.photos.map(\.fileURL.path),
            expectedFileCount: submission.photos.count,
            serverOrigin: client?.serverURL.absoluteString,
            organizationID: client?.organizationID,
            principalIdentifier: client?.principalIdentifier,
            shouldAnalyze: submission.analyze,
            shouldGenerateCover: submission.generateCover,
            imageModelID: submission.imageModelID,
            stage: .preparing,
            progress: 0.03,
            resourceID: nil,
            resourceName: nil,
            mediaUploaded: submission.photos.isEmpty,
            analysisCompleted: !submission.analyze,
            coverCompleted: !submission.generateCover,
            analysisOperationID: submission.analyze ? UUID() : nil,
            coverOperationID: submission.generateCover ? UUID() : nil,
            maximumAIGeneratedImagePixelSize: submission.maximumAIGeneratedImagePixelSize,
            shouldResearch: submission.research,
            researchCompleted: !submission.research,
            researchOperationID: submission.research ? UUID() : nil,
            analysisOverwrite: submission.analysisOverwrite,
            analysisPrompt: submission.analyze ? submission.analysisPrompt : nil,
            coverPrompt: submission.generateCover ? submission.coverPrompt : nil,
            spatialPlacement: submission.spatialPlacement,
            placementCompleted: submission.spatialPlacement == nil,
            placementWarning: nil,
            attemptCount: 0,
            nextAttemptAt: nil,
            message: L10n.text("ui_saving_media_for_upload_9d87d83b")
        )
        jobs.insert(job, at: 0)
        persist()

        let jobDirectory = directory(for: submission.id)
        Task {
            do {
                let filenames = try await Self.importPhotos(
                    submission.photos,
                    to: jobDirectory
                )
                job.filenames = filenames
                job.sourceFilePaths = []
                if job.serverOrigin == nil || job.principalIdentifier == nil {
                    job.stage = .failed
                    job.progress = 1
                    job.message = L10n.text("ui_no_secure_account_and_server_context_is_4c52ef85")
                } else {
                    job.stage = .queued
                    job.progress = 0.08
                    job.message = Self.matchesContext(
                        job,
                        serverOrigin: client?.serverURL.absoluteString,
                        organizationID: client?.organizationID,
                        principalIdentifier: client?.principalIdentifier
                    )
                        ? L10n.text("ui_ready_to_upload_618f4a78")
                        : L10n.text("ui_media_saved_switch_to_the_associated_account_be6d11f9")
                }
                let persisted = replace(job)
                if persisted {
                    Self.cleanupImportedSources(submission.photos)
                    startWorkerIfNeeded()
                } else {
                    job.stage = .failed
                    job.progress = 1
                    job.message = L10n.text("ui_media_saved_but_queue_status_could_not_2f4eb800")
                    replace(job)
                }
            } catch {
                job.stage = .failed
                job.progress = 1
                job.message = L10n.text("ui_could_not_save_media_0_b0e83b48", error.localizedDescription)
                replace(job)
            }
        }
    }

    func retry(_ id: UUID) {
        guard var job = visibleJobs.first(where: { $0.id == id }) else { return }
        guard let client, canProcessJobs else {
            job.stage = .failed
            job.message = L10n.text("ui_write_access_to_this_inventory_is_required_648f30c6")
            replace(job)
            return
        }
        let currentOrigin = client.serverURL.absoluteString
        guard Self.matchesContext(
            job,
            serverOrigin: currentOrigin,
            organizationID: client.organizationID,
            principalIdentifier: client.principalIdentifier
        ) else {
            job.stage = .failed
            job.message =
                L10n.text("ui_this_job_belongs_to_another_server_or_04d984ea")
            replace(job)
            return
        }
        if !job.mediaUploaded,
           !Self.filesExist(for: job, rootURL: rootURL),
           Self.sourceFilesExist(for: job) {
            job.stage = .preparing
            job.progress = 0.03
            job.message = L10n.text("ui_safely_importing_local_media_again_7e7e7afe")
            replace(job)
            Task { await resumePreparingJob(id) }
            return
        }
        guard job.mediaUploaded || Self.filesExist(for: job, rootURL: rootURL) else {
            job.stage = .failed
            job.progress = 1
            job.message = L10n.text("ui_local_media_is_no_longer_complete_please_db97eabb")
            replace(job)
            return
        }
        job.stage = .queued
        job.progress = job.resourceID == nil ? 0.08 : (job.mediaUploaded ? 0.62 : 0.28)
        if job.stage == .warning || (job.shouldAnalyze && !job.analysisCompleted) {
            job.analysisOperationID = UUID()
        } else if job.shouldResearch == true && job.researchCompleted != true {
            job.researchOperationID = UUID()
        } else if job.shouldGenerateCover && !job.coverCompleted {
            job.coverOperationID = UUID()
        }
        job.attemptCount = 0
        job.nextAttemptAt = nil
        job.message = L10n.text("ui_retrying_a11bae74")
        replace(job)
        startWorkerIfNeeded()
    }

    func remove(_ id: UUID) {
        guard let job = visibleJobs.first(where: { $0.id == id }), job.stage.isTerminal else { return }
        let previousJobs = jobs
        jobs.removeAll { $0.id == id }
        guard persist() else {
            jobs = previousJobs
            return
        }
        let directory = directory(for: id)
        Task.detached(priority: .utility) {
            try? FileManager.default.removeItem(at: directory)
        }
    }

    private func startWorkerIfNeeded() {
        guard let client, canProcessJobs, worker == nil,
              let principalIdentifier = client.principalIdentifier else {
            return
        }
        let origin = client.serverURL.absoluteString
        let organizationID = client.organizationID
        guard jobs.contains(where: {
            $0.stage == .queued &&
                Self.matchesContext(
                    $0,
                    serverOrigin: origin,
                    organizationID: organizationID,
                    principalIdentifier: principalIdentifier
                )
        }) else { return }
        let generation = configurationID
        worker = Task { [weak self] in
            guard let self else { return }
            await self.processQueuedJobs(
                using: client,
                origin: origin,
                organizationID: organizationID,
                principalIdentifier: principalIdentifier,
                generation: generation
            )
            guard self.configurationID == generation else { return }
            self.worker = nil
            self.startWorkerIfNeeded()
        }
    }

    private func processQueuedJobs(
        using client: APIClient,
        origin: String,
        organizationID: UUID?,
        principalIdentifier: String,
        generation: UUID
    ) async {
        while !Task.isCancelled, configurationID == generation {
            let candidates = jobs
                .filter({
                    $0.stage == .queued &&
                        Self.matchesContext(
                            $0,
                            serverOrigin: origin,
                            organizationID: organizationID,
                            principalIdentifier: principalIdentifier
                        )
                })
                .sorted(by: { $0.createdAt < $1.createdAt })
            guard !candidates.isEmpty else { return }

            let now = Date()
            if let nextID = candidates.first(where: {
                ($0.nextAttemptAt ?? .distantPast) <= now
            })?.id {
                await process(nextID, using: client, generation: generation)
                continue
            }

            guard let wakeDate = candidates.compactMap(\.nextAttemptAt).min() else { return }
            let nanoseconds = UInt64(
                max(0.2, min(300, wakeDate.timeIntervalSinceNow)) * 1_000_000_000
            )
            do {
                try await Task.sleep(nanoseconds: nanoseconds)
            } catch {
                return
            }
        }
    }

    private func process(
        _ id: UUID,
        using client: APIClient,
        generation: UUID
    ) async {
        guard var job = jobs.first(where: { $0.id == id }) else { return }

        do {
            try Task.checkCancellation()
            if job.resourceID == nil {
                job.stage = .creating
                job.progress = 0.14
                job.message = L10n.text("ui_creating_bc4a3064")
                replace(job)

                let resource = try await client.createResource(
                    job.request,
                    idempotencyKey: job.id
                )
                job.resourceID = resource.id
                job.resourceName = resource.name
                job.progress = 0.28
                guard replace(job) else { throw IntakeQueuePersistenceError.unableToPersist }
                guard configurationID == generation else { throw CancellationError() }
                try Task.checkCancellation()
            }

            guard let resourceID = job.resourceID else {
                throw APIClientError.invalidResponse
            }

            if let spatialPlacement = job.spatialPlacement,
               job.placementCompleted != true {
                job.stage = .placing
                job.progress = 0.34
                job.message = L10n.text("ui_saving_3d_position_in_room_b4375fd1")
                replace(job)

                do {
                    _ = try await client.saveSpatialPlacement(
                        resourceID: resourceID,
                        draft: spatialPlacement
                    )
                    job.placementCompleted = true
                    job.placementWarning = nil
                    job.progress = 0.4
                } catch let error as APIClientError where error.statusCode == 409 {
                    // A room may be rescanned while this durable job is waiting.
                    // Keep the new item and its media instead of retrying the
                    // now-invalid coordinate frame forever.
                    job.placementCompleted = true
                    job.placementWarning =
                        L10n.text("ui_the_room_has_been_rescanned_in_the_6ffc315d")
                    job.progress = 0.4
                }
                guard replace(job) else { throw IntakeQueuePersistenceError.unableToPersist }
                guard configurationID == generation else { throw CancellationError() }
                try Task.checkCancellation()
            }

            if !job.mediaUploaded {
                job.stage = .uploading
                job.progress = 0.44
                job.message = L10n.text("ui_uploading_0_media_files_023ac035", job.filenames.count)
                replace(job)

                let files = job.filenames.enumerated().map { index, filename in
                    MediaUploadFile(
                        fileURL: directory(for: job.id).appendingPathComponent(filename),
                        filename: job.mediaOriginalNames?[safe: index] ?? filename,
                        mimeType: job.mediaMIMETypes?[safe: index] ?? "image/jpeg"
                    )
                }
                _ = try await client.uploadMedia(
                    resourceID: resourceID,
                    files: files,
                    idempotencyKey: job.id
                )
                job.mediaUploaded = true
                job.progress = 0.62
                guard replace(job) else { throw IntakeQueuePersistenceError.unableToPersist }
                guard configurationID == generation else { throw CancellationError() }
                try Task.checkCancellation()
            }

            if job.shouldAnalyze && !job.analysisCompleted {
                job.stage = .analyzing
                job.progress = 0.7
                job.message = L10n.text("ui_analyzing_42d37d21")
                replace(job)

                do {
                    let response = try await client.analyzeResource(
                        id: resourceID,
                        overwrite: job.analysisOverwrite ?? true,
                        prompt: job.analysisPrompt,
                        idempotencyKey: job.analysisOperationID ?? job.id
                    )
                    job.resourceName = response.resource.name
                    job.analysisCompleted = true
                    job.progress = job.shouldGenerateCover ? 0.84 : 1
                    guard replace(job) else { throw IntakeQueuePersistenceError.unableToPersist }
                    guard configurationID == generation else { throw CancellationError() }
                    try Task.checkCancellation()
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    if Self.requiresAuthentication(error) { throw error }
                    if Self.isRetryable(error) { throw error }
                    job.stage = .warning
                    job.progress = 1
                    job.message = L10n.text("ui_item_and_media_saved_but_analysis_failed_7c342de1", error.localizedDescription)
                    replace(job)
                    return
                }
            }

            if job.shouldResearch == true && job.researchCompleted != true {
                job.stage = .researching
                job.progress = 0.82
                job.message = L10n.text("ui_researching_the_web_8766f7e8")
                guard replace(job) else { throw IntakeQueuePersistenceError.unableToPersist }
                do {
                    let resource = try await client.researchResource(id: resourceID, idempotencyKey: job.researchOperationID ?? job.id)
                    job.resourceName = resource.name
                    job.researchCompleted = true
                    guard replace(job) else { throw IntakeQueuePersistenceError.unableToPersist }
                    guard configurationID == generation else { throw CancellationError() }
                    try Task.checkCancellation()
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    if Self.requiresAuthentication(error) || Self.isRetryable(error) { throw error }
                    job.stage = .warning
                    job.progress = 1
                    job.message = L10n.text("ui_item_and_media_saved_but_research_failed_ec57ff2e", error.localizedDescription)
                    replace(job)
                    return
                }
            }

            if job.shouldGenerateCover && !job.coverCompleted {
                job.stage = .generatingCover
                job.progress = 0.88
                job.message = L10n.text("ui_creating_cover_eee10bf8")
                replace(job)

                do {
                    let response = try await client.generateCover(
                        resourceID: resourceID,
                        prompt: job.coverPrompt,
                        modelID: job.imageModelID,
                        maximumImageSize: job.maximumAIGeneratedImagePixelSize,
                        idempotencyKey: job.coverOperationID ?? job.id
                    )
                    job.resourceName = response.resource.name
                    job.coverCompleted = true
                    guard replace(job) else { throw IntakeQueuePersistenceError.unableToPersist }
                    guard configurationID == generation else { throw CancellationError() }
                    try Task.checkCancellation()
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    if Self.requiresAuthentication(error) { throw error }
                    if Self.isRetryable(error) { throw error }
                    job.stage = .warning
                    job.progress = 1
                    job.message = L10n.text("ui_item_saved_but_cover_creation_failed_0_b73cce59", error.localizedDescription)
                    replace(job)
                    return
                }
            }

            job.stage = job.placementWarning == nil ? .complete : .warning
            job.progress = 1
            job.attemptCount = 0
            job.nextAttemptAt = nil
            job.message = job.placementWarning.map {
                L10n.text("ui_item_and_media_saved_0_a76f4362", $0)
            } ?? L10n.text("ui_done_2d921abe")
            if replace(job) {
                cleanupPhotoFiles(for: job.id)
            }
        } catch is CancellationError {
            job.stage = .queued
            job.nextAttemptAt = nil
            job.message = L10n.text("ui_upload_paused_60b41ccb")
            replace(job)
        } catch {
            let attempt = (job.attemptCount ?? 0) + 1
            let statusCode = (error as? APIClientError)?.statusCode
            if Self.requiresAuthentication(error) {
                job.stage = .queued
                job.nextAttemptAt = nil
                job.message = L10n.text("ui_sign_in_required_0ef83864")
                replace(job)
                return
            }
            let maximumAttempts: Int
            if statusCode == 202 {
                maximumAttempts = 90
            } else if job.stage == .analyzing || job.stage == .researching || job.stage == .generatingCover {
                maximumAttempts = 2
            } else {
                maximumAttempts = 6
            }
            if Self.isRetryable(error), attempt <= maximumAttempts {
                let delay = Self.retryDelay(for: error, attempt: attempt)
                job.stage = .queued
                job.attemptCount = attempt
                job.nextAttemptAt = Date().addingTimeInterval(delay)
                job.message = statusCode == 202
                    ? L10n.text("ui_ai_operation_still_running_next_status_check_2060bad3", Int(ceil(delay)))
                    : L10n.text("ui_connection_lost_automatic_attempt_0_1_in_a1652b2c", attempt, maximumAttempts, Int(ceil(delay)))
            } else {
                job.stage = .failed
                job.progress = 1
                job.attemptCount = attempt
                job.nextAttemptAt = nil
                job.message = error.localizedDescription
            }
            replace(job)
        }
    }

    @discardableResult
    private func replace(_ job: IntakeJob) -> Bool {
        guard let index = jobs.firstIndex(where: { $0.id == job.id }) else { return false }
        jobs[index] = job
        jobs.sort { $0.createdAt > $1.createdAt }
        return persist()
    }

    private func directory(for id: UUID) -> URL {
        rootURL.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    private func cleanupPhotoFiles(for id: UUID) {
        let directory = directory(for: id)
        Task.detached(priority: .utility) {
            try? FileManager.default.removeItem(at: directory)
        }
    }

    @discardableResult
    private func persist() -> Bool {
        let snapshot = jobs
        let url = manifestURL
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(snapshot)
            try data.write(to: url, options: .atomic)
            try data.write(to: manifestBackupURL, options: .atomic)
            storageError = nil
            return true
        } catch {
            storageError = L10n.text("ui_could_not_persist_upload_queue_0_b97b415c", error.localizedDescription)
            return false
        }
    }

    private static func loadManifest(
        from url: URL,
        backupURL: URL
    ) -> (jobs: [IntakeJob], error: String?) {
        guard FileManager.default.fileExists(atPath: url.path) else { return ([], nil) }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return (try decoder.decode([IntakeJob].self, from: Data(contentsOf: url)), nil)
        } catch {
            do {
                let jobs = try decoder.decode(
                    [IntakeJob].self,
                    from: Data(contentsOf: backupURL)
                )
                return (
                    jobs,
                    L10n.text("ui_the_main_queue_was_damaged_the_backup_646d0f77")
                )
            } catch {
                return (
                    [],
                    L10n.text("ui_the_upload_queue_is_damaged_and_was_ec3dc288")
                )
            }
        }
    }

    nonisolated private static func uploadExtension(for file: MediaUploadFile) -> String {
        let candidate = file.fileURL.pathExtension.lowercased()
        if !candidate.isEmpty,
           candidate.count <= 10,
           candidate.unicodeScalars.allSatisfy(CharacterSet.alphanumerics.contains) {
            return candidate
        }
        return switch file.mimeType {
        case "video/quicktime": "mov"
        case "video/mp4": "mp4"
        case "video/webm": "webm"
        case "application/pdf": "pdf"
        case "image/png": "png"
        default: "jpg"
        }
    }

    private static func importPhotos(
        _ photos: [MediaUploadFile],
        to directory: URL
    ) async throws -> [String] {
        try await Task.detached(priority: .utility) {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            var names: [String] = []
            do {
                for (index, photo) in photos.enumerated() {
                    let fileExtension = uploadExtension(for: photo)
                    let name = String(
                        format: "%02d-%@.%@",
                        index + 1,
                        UUID().uuidString,
                        fileExtension
                    )
                    let destination = directory.appendingPathComponent(name)
                    try FileManager.default.copyItem(at: photo.fileURL, to: destination)
                    names.append(name)
                }
                guard names.count == photos.count else {
                    throw CocoaError(.fileWriteUnknown)
                }
                return names
            } catch {
                try? FileManager.default.removeItem(at: directory)
                throw error
            }
        }.value
    }

    nonisolated static func recover(_ source: IntakeJob, rootURL: URL) -> IntakeJob {
        var job = source
        guard !job.stage.isTerminal else { return job }

        guard job.serverOrigin != nil, job.principalIdentifier != nil else {
            job.stage = .failed
            job.progress = 1
            job.message = L10n.text("ui_the_interrupted_job_has_no_secure_account_92c2155d")
            return job
        }

        if !job.mediaUploaded {
            let directory = rootURL.appendingPathComponent(job.id.uuidString, isDirectory: true)
            let recoveredNames = (try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles]
            ))?
                .filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
                .map(\.lastPathComponent)
                .sorted() ?? []
            let names = job.filenames.isEmpty ? recoveredNames : job.filenames
            let expected = job.expectedFileCount ?? names.count
            let completeOutbox = expected > 0 &&
                names.count == expected &&
                names.allSatisfy({ FileManager.default.fileExists(
                    atPath: directory.appendingPathComponent($0).path
                ) })
            if !completeOutbox, sourceFilesExist(for: job) {
                job.stage = .preparing
                job.progress = 0.03
                job.message = L10n.text("ui_secure_media_import_will_resume_after_restarting_7fc6c57f")
                return job
            }
            guard completeOutbox else {
                job.stage = .failed
                job.progress = 1
                job.message = L10n.text("ui_media_import_was_interrupted_no_incomplete_files_6093b85c")
                return job
            }
            job.filenames = names
        }

        job.stage = .queued
        job.message = L10n.text("ui_safely_resumed_after_app_restart_a1e2d2be")
        return job
    }

    nonisolated static func matchesContext(
        _ job: IntakeJob,
        serverOrigin: String?,
        organizationID: UUID?,
        principalIdentifier: String?
    ) -> Bool {
        guard let principalIdentifier else { return false }
        return job.serverOrigin == serverOrigin &&
            job.organizationID == organizationID &&
            job.principalIdentifier == principalIdentifier
    }

    nonisolated static func jobs(
        _ jobs: [IntakeJob],
        matchingServerOrigin serverOrigin: String?,
        organizationID: UUID?,
        principalIdentifier: String?
    ) -> [IntakeJob] {
        jobs.filter {
            matchesContext(
                $0,
                serverOrigin: serverOrigin,
                organizationID: organizationID,
                principalIdentifier: principalIdentifier
            )
        }
    }

    private static func filesExist(for job: IntakeJob, rootURL: URL) -> Bool {
        let expected = job.expectedFileCount ?? job.filenames.count
        guard expected > 0, job.filenames.count == expected else { return false }
        let directory = rootURL.appendingPathComponent(job.id.uuidString, isDirectory: true)
        return job.filenames.allSatisfy {
            FileManager.default.fileExists(atPath: directory.appendingPathComponent($0).path)
        }
    }

    nonisolated private static func sourceFilesExist(for job: IntakeJob) -> Bool {
        let paths = job.sourceFilePaths ?? []
        let expected = job.expectedFileCount ?? paths.count
        return expected > 0 && paths.count == expected && paths.allSatisfy {
            FileManager.default.fileExists(atPath: $0)
        }
    }

    private func resumePreparingJobs() async {
        let origin = client?.serverURL.absoluteString
        let organizationID = client?.organizationID
        let principalIdentifier = client?.principalIdentifier
        let identifiers = jobs.filter {
            $0.stage == .preparing &&
                Self.matchesContext(
                    $0,
                    serverOrigin: origin,
                    organizationID: organizationID,
                    principalIdentifier: principalIdentifier
                )
        }.map(\.id)
        for id in identifiers {
            await resumePreparingJob(id)
        }
    }

    private func resumePreparingJob(_ id: UUID) async {
        guard var job = jobs.first(where: { $0.id == id }),
              job.stage == .preparing,
              Self.sourceFilesExist(for: job) else { return }
        let photos = (job.sourceFilePaths ?? []).enumerated().map { index, path in
            MediaUploadFile(
                fileURL: URL(fileURLWithPath: path),
                filename: job.mediaOriginalNames?[safe: index],
                mimeType: job.mediaMIMETypes?[safe: index] ?? "image/jpeg"
            )
        }
        let jobDirectory = directory(for: id)
        do {
            if FileManager.default.fileExists(atPath: jobDirectory.path) {
                try FileManager.default.removeItem(at: jobDirectory)
            }
            let filenames = try await Self.importPhotos(photos, to: jobDirectory)
            job.filenames = filenames
            job.sourceFilePaths = []
            job.stage = .queued
            job.progress = 0.08
            job.message = Self.matchesContext(
                job,
                serverOrigin: client?.serverURL.absoluteString,
                organizationID: client?.organizationID,
                principalIdentifier: client?.principalIdentifier
            )
                ? L10n.text("ui_media_fully_restored_and_ready_b6285b7e")
                : L10n.text("ui_media_restored_switch_to_the_associated_account_59f3b5b0")
            if replace(job) {
                Self.cleanupImportedSources(photos)
                startWorkerIfNeeded()
            } else {
                job.stage = .failed
                job.progress = 1
                job.message = L10n.text("ui_media_restored_but_queue_status_could_not_571da8b8")
                replace(job)
            }
        } catch {
            job.stage = .failed
            job.progress = 1
            job.message = L10n.text("ui_could_not_restore_media_0_9181cd41", error.localizedDescription)
            replace(job)
        }
    }

    private static func cleanupImportedSources(_ photos: [MediaUploadFile]) {
        Task.detached(priority: .utility) {
            for photo in photos {
                try? FileManager.default.removeItem(at: photo.fileURL)
            }
        }
    }

    private static func isRetryable(_ error: Error) -> Bool {
        guard let apiError = error as? APIClientError else { return false }
        switch apiError {
        case .transport:
            return true
        case .http(let statusCode, _, _, _):
            return statusCode == 202 || statusCode == 408 || statusCode == 425 ||
                statusCode == 429 || statusCode >= 500
        default:
            return false
        }
    }

    nonisolated static func requiresAuthentication(_ error: Error) -> Bool {
        (error as? APIClientError)?.statusCode == 401
    }

    private static func retryDelay(for error: Error, attempt: Int) -> TimeInterval {
        if let apiError = error as? APIClientError, let retryAfter = apiError.retryAfter {
            return min(300, max(1, retryAfter))
        }
        let base = min(120, pow(2, Double(attempt)))
        return base + Double.random(in: 0 ... min(3, base * 0.2))
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

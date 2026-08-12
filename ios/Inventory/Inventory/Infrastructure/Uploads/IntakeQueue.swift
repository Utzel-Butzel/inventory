import Foundation

private enum IntakeQueuePersistenceError: Error, LocalizedError {
    case unableToPersist

    var errorDescription: String? {
        "Der Upload-Status konnte nicht dauerhaft auf dem Gerät gesichert werden."
    }
}

enum IntakeJobStage: String, Codable, Sendable {
    case preparing
    case queued
    case creating
    case placing
    case uploading
    case analyzing
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
    var sourceFilePaths: [String]?
    var expectedFileCount: Int?
    var serverOrigin: String?
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
            storageError = "Upload-Speicher konnte nicht geöffnet werden: \(error.localizedDescription)"
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

    func configure(client: APIClient?) {
        configurationID = UUID()
        worker?.cancel()
        worker = nil
        self.client = client
        if let origin = client?.serverURL.absoluteString {
            var changed = false
            for index in jobs.indices where
                !jobs[index].stage.isTerminal &&
                jobs[index].serverOrigin != origin {
                jobs[index].stage = .failed
                jobs[index].progress = 1
                jobs[index].message = "Upload pausiert: Dieser Auftrag gehört zu einem anderen Server."
                changed = true
            }
            if changed { persist() }
            Task { [weak self] in
                await self?.resumePreparingJobs()
            }
        }
        startWorkerIfNeeded()
    }

    func enqueue(_ submission: IntakeSubmission) {
        var job = IntakeJob(
            id: submission.id,
            createdAt: Date(),
            request: submission.request,
            filenames: [],
            sourceFilePaths: submission.photos.map(\.fileURL.path),
            expectedFileCount: submission.photos.count,
            serverOrigin: client?.serverURL.absoluteString,
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
            spatialPlacement: submission.spatialPlacement,
            placementCompleted: submission.spatialPlacement == nil,
            placementWarning: nil,
            attemptCount: 0,
            nextAttemptAt: nil,
            message: "Fotos werden für den Upload gesichert."
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
                if job.serverOrigin == nil {
                    job.stage = .failed
                    job.progress = 1
                    job.message = "Kein Inventory-Server ist diesem Auftrag zugeordnet."
                } else if job.serverOrigin != client?.serverURL.absoluteString {
                    job.stage = .failed
                    job.progress = 1
                    job.message = "Fotos sind gesichert; der Auftrag gehört jedoch zu einem anderen Server."
                } else {
                    job.stage = .queued
                    job.progress = 0.08
                    job.message = "Bereit zum Hochladen."
                }
                let persisted = replace(job)
                if persisted {
                    Self.cleanupImportedSources(submission.photos)
                    startWorkerIfNeeded()
                } else {
                    job.stage = .failed
                    job.progress = 1
                    job.message = "Fotos sind gesichert, aber der Queue-Status konnte nicht gespeichert werden."
                    replace(job)
                }
            } catch {
                job.stage = .failed
                job.progress = 1
                job.message = "Fotos konnten nicht gesichert werden: \(error.localizedDescription)"
                replace(job)
            }
        }
    }

    func retry(_ id: UUID) {
        guard var job = jobs.first(where: { $0.id == id }) else { return }
        guard let client else {
            job.stage = .failed
            job.message = "Für den erneuten Versuch zuerst mit Inventory verbinden."
            replace(job)
            return
        }
        let currentOrigin = client.serverURL.absoluteString
        if job.serverOrigin == nil {
            job.serverOrigin = currentOrigin
        }
        guard job.serverOrigin == currentOrigin else {
            job.stage = .failed
            let assignedOrigin = job.serverOrigin ?? "einem anderen Server"
            job.message = "Dieser Auftrag gehört zu \(assignedOrigin). Wechsle dorthin zurück, um ihn fortzusetzen."
            replace(job)
            return
        }
        if !job.mediaUploaded,
           !Self.filesExist(for: job, rootURL: rootURL),
           Self.sourceFilesExist(for: job) {
            job.stage = .preparing
            job.progress = 0.03
            job.message = "Lokale Fotos werden erneut sicher übernommen."
            replace(job)
            Task { await resumePreparingJob(id) }
            return
        }
        guard job.mediaUploaded || Self.filesExist(for: job, rootURL: rootURL) else {
            job.stage = .failed
            job.progress = 1
            job.message = "Die lokalen Fotos sind nicht mehr vollständig. Bitte den Auftrag entfernen und neu aufnehmen."
            replace(job)
            return
        }
        job.stage = .queued
        job.progress = job.resourceID == nil ? 0.08 : (job.mediaUploaded ? 0.62 : 0.28)
        if job.stage == .warning || (job.shouldAnalyze && !job.analysisCompleted) {
            job.analysisOperationID = UUID()
        } else if job.shouldGenerateCover && !job.coverCompleted {
            job.coverOperationID = UUID()
        }
        job.attemptCount = 0
        job.nextAttemptAt = nil
        job.message = "Erneuter Versuch …"
        replace(job)
        startWorkerIfNeeded()
    }

    func remove(_ id: UUID) {
        guard let job = jobs.first(where: { $0.id == id }), job.stage.isTerminal else { return }
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
        guard let client, worker == nil else {
            return
        }
        let origin = client.serverURL.absoluteString
        guard jobs.contains(where: {
            $0.stage == .queued && $0.serverOrigin == origin
        }) else { return }
        let generation = configurationID
        worker = Task { [weak self] in
            guard let self else { return }
            await self.processQueuedJobs(
                using: client,
                origin: origin,
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
        generation: UUID
    ) async {
        while !Task.isCancelled, configurationID == generation {
            let candidates = jobs
                .filter({ $0.stage == .queued && $0.serverOrigin == origin })
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
                job.message = "Wird angelegt."
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
                job.message = "3D-Position wird im Raum gespeichert."
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
                    // Keep the new item and its photos instead of retrying the
                    // now-invalid coordinate frame forever.
                    job.placementCompleted = true
                    job.placementWarning =
                        "Der Raum wurde zwischenzeitlich neu gescannt; die 3D-Position muss erneut erfasst werden."
                    job.progress = 0.4
                }
                guard replace(job) else { throw IntakeQueuePersistenceError.unableToPersist }
                guard configurationID == generation else { throw CancellationError() }
                try Task.checkCancellation()
            }

            if !job.mediaUploaded {
                job.stage = .uploading
                job.progress = 0.44
                job.message = "\(job.filenames.count) Foto(s) werden hochgeladen."
                replace(job)

                let files = job.filenames.map {
                    MediaUploadFile(fileURL: directory(for: job.id).appendingPathComponent($0))
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
                job.message = "Analyse läuft."
                replace(job)

                do {
                    let response = try await client.analyzeResource(
                        id: resourceID,
                        overwrite: true,
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
                    job.message = "Gegenstand und Fotos sind gespeichert, die Analyse schlug jedoch fehl: \(error.localizedDescription)"
                    replace(job)
                    return
                }
            }

            if job.shouldGenerateCover && !job.coverCompleted {
                job.stage = .generatingCover
                job.progress = 0.88
                job.message = "Cover wird erstellt."
                replace(job)

                do {
                    let response = try await client.generateCover(
                        resourceID: resourceID,
                        modelID: job.imageModelID,
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
                    job.message = "Gegenstand ist gespeichert, das Cover schlug jedoch fehl: \(error.localizedDescription)"
                    replace(job)
                    return
                }
            }

            job.stage = job.placementWarning == nil ? .complete : .warning
            job.progress = 1
            job.attemptCount = 0
            job.nextAttemptAt = nil
            job.message = job.placementWarning.map {
                "Gegenstand und Fotos sind gespeichert. \($0)"
            } ?? "Fertig."
            if replace(job) {
                cleanupPhotoFiles(for: job.id)
            }
        } catch is CancellationError {
            let activeOrigin = clientForCurrentConfiguration?.serverURL.absoluteString
            if let activeOrigin, job.serverOrigin != activeOrigin {
                job.stage = .failed
                job.progress = 1
                job.message = "Upload pausiert: Dieser Auftrag gehört zu einem anderen Server."
            } else {
                job.stage = .queued
                job.nextAttemptAt = nil
                job.message = "Upload pausiert."
            }
            replace(job)
        } catch {
            let attempt = (job.attemptCount ?? 0) + 1
            let statusCode = (error as? APIClientError)?.statusCode
            if Self.requiresAuthentication(error) {
                job.stage = .queued
                job.nextAttemptAt = nil
                job.message = "Anmeldung erforderlich."
                replace(job)
                return
            }
            let maximumAttempts: Int
            if statusCode == 202 {
                maximumAttempts = 90
            } else if job.stage == .analyzing || job.stage == .generatingCover {
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
                    ? "KI-Vorgang läuft noch. Nächste Statusprüfung in \(Int(ceil(delay))) s."
                    : "Verbindung unterbrochen. Automatischer Versuch \(attempt)/\(maximumAttempts) in \(Int(ceil(delay))) s."
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
            storageError = "Upload-Queue konnte nicht dauerhaft gesichert werden: \(error.localizedDescription)"
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
                    "Die Haupt-Queue war beschädigt; die Sicherung wurde geladen."
                )
            } catch {
                return (
                    [],
                    "Die Upload-Queue ist beschädigt und wurde nicht überschrieben."
                )
            }
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
                    let name = String(format: "%02d-%@.jpg", index + 1, UUID().uuidString)
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

        guard job.serverOrigin != nil else {
            job.stage = .failed
            job.progress = 1
            job.message = "Der unterbrochene Auftrag hat keine sichere Serverzuordnung."
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
                job.message = "Die sichere Fotoübernahme wird nach dem Neustart fortgesetzt."
                return job
            }
            guard completeOutbox else {
                job.stage = .failed
                job.progress = 1
                job.message = "Die Fotoübernahme wurde unterbrochen. Es wird nichts unvollständig hochgeladen."
                return job
            }
            job.filenames = names
        }

        job.stage = .queued
        job.message = "Nach App-Neustart sicher fortgesetzt."
        return job
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
        let identifiers = jobs.filter {
            $0.stage == .preparing && $0.serverOrigin == origin
        }.map(\.id)
        for id in identifiers {
            await resumePreparingJob(id)
        }
    }

    private func resumePreparingJob(_ id: UUID) async {
        guard var job = jobs.first(where: { $0.id == id }),
              job.stage == .preparing,
              Self.sourceFilesExist(for: job) else { return }
        let photos = (job.sourceFilePaths ?? []).map {
            MediaUploadFile(fileURL: URL(fileURLWithPath: $0))
        }
        let jobDirectory = directory(for: id)
        do {
            if FileManager.default.fileExists(atPath: jobDirectory.path) {
                try FileManager.default.removeItem(at: jobDirectory)
            }
            let filenames = try await Self.importPhotos(photos, to: jobDirectory)
            job.filenames = filenames
            job.sourceFilePaths = []
            if job.serverOrigin == client?.serverURL.absoluteString {
                job.stage = .queued
                job.progress = 0.08
                job.message = "Fotos vollständig wiederhergestellt und bereit."
            } else {
                job.stage = .failed
                job.progress = 1
                job.message = "Fotos sind wiederhergestellt; der Auftrag gehört zu einem anderen Server."
            }
            if replace(job) {
                Self.cleanupImportedSources(photos)
                startWorkerIfNeeded()
            } else {
                job.stage = .failed
                job.progress = 1
                job.message = "Fotos sind wiederhergestellt, aber der Queue-Status konnte nicht gespeichert werden."
                replace(job)
            }
        } catch {
            job.stage = .failed
            job.progress = 1
            job.message = "Fotos konnten nicht wiederhergestellt werden: \(error.localizedDescription)"
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
        case .http(let statusCode, _, _):
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

    private var clientForCurrentConfiguration: APIClient? { client }
}

import Foundation

public enum APIClientError: Error, LocalizedError, Sendable {
    case invalidServerURL
    case missingCredential
    case invalidRequest(String)
    case invalidUpload(String)
    case transport(String)
    case invalidResponse
    case decoding(String)
    case http(
        statusCode: Int,
        message: String,
        retryAfter: TimeInterval?,
        terminal: Bool = false
    )

    public var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            return "The inventory server URL is invalid."
        case .missingCredential:
            return "Kein Zugang gespeichert."
        case .invalidRequest(let message), .invalidUpload(let message):
            return message
        case .transport(let message):
            return "The inventory server could not be reached: \(message)"
        case .invalidResponse:
            return "The inventory server returned an invalid response."
        case .decoding(let message):
            return "The inventory response could not be read: \(message)"
        case .http(_, let message, _, _):
            return message
        }
    }

    public var statusCode: Int? {
        guard case .http(let statusCode, _, _, _) = self else { return nil }
        return statusCode
    }

    public var retryAfter: TimeInterval? {
        guard case .http(_, _, let retryAfter, _) = self else { return nil }
        return retryAfter
    }

    public var isTerminal: Bool {
        guard case .http(_, _, _, let terminal) = self else { return false }
        return terminal
    }
}

public final class APIClient: Sendable {
    public let serverURL: URL
    public let apiBaseURL: URL
    public let organizationID: UUID?
    public let principalIdentifier: String?

    public var contextIdentifier: String {
        let organization = organizationID?.uuidString.lowercased() ?? "legacy"
        let principal = principalIdentifier ?? "anonymous"
        return "\(serverURL.absoluteString)#\(organization)#\(principal)"
    }

    private let credentialStore: any CredentialStore
    private let session: URLSession
    private let objectCountSession: URLSession
    private let onUnauthorized: (@Sendable () async -> Void)?

    private static let objectCountTimeout: TimeInterval = 80

    /// `serverURL` is the deployment root, for example `https://inventory.example`,
    /// not the `/api/v1` URL. This lets relative `/api/files/...` media resolve safely.
    public init(
        serverURL: URL,
        credentialStore: any CredentialStore,
        organizationID: UUID? = nil,
        principalIdentifier: String? = nil,
        session: URLSession? = nil,
        onUnauthorized: (@Sendable () async -> Void)? = nil
    ) throws {
        guard let normalizedURL = Self.normalizeServerURL(serverURL) else {
            throw APIClientError.invalidServerURL
        }
        self.serverURL = normalizedURL
        self.apiBaseURL = normalizedURL
            .appendingPathComponent("api", isDirectory: true)
            .appendingPathComponent("v1", isDirectory: true)
        self.organizationID = organizationID
        self.principalIdentifier = principalIdentifier
        self.credentialStore = credentialStore
        if let session {
            // Preserve the injected configuration (including URLProtocol test doubles),
            // but clone it so the count timeout cannot affect unrelated API traffic.
            self.session = session
            self.objectCountSession = Self.makeObjectCountSession(
                for: normalizedURL,
                basedOn: session.configuration
            )
        } else {
            self.session = Self.makeSecureSession(for: normalizedURL)
            self.objectCountSession = Self.makeObjectCountSession(
                for: normalizedURL,
                basedOn: .default
            )
        }
        self.onUnauthorized = onUnauthorized
    }

    public func listResources(
        query: String? = nil,
        type: InventoryResourceType? = nil,
        status: InventoryResourceStatus? = nil,
        page: Int = 1,
        pageSize: Int = 24
    ) async throws -> ResourceListResponse {
        guard page >= 1 else {
            throw APIClientError.invalidRequest("Page must be at least one.")
        }
        guard (1 ... 100).contains(pageSize) else {
            throw APIClientError.invalidRequest("Page size must be between one and 100.")
        }

        var queryItems = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "pageSize", value: String(pageSize)),
        ]
        if let query, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            queryItems.append(URLQueryItem(name: "q", value: query))
        }
        if let type {
            queryItems.append(URLQueryItem(name: "type", value: type.rawValue))
        }
        if let status {
            queryItems.append(URLQueryItem(name: "status", value: status.rawValue))
        }

        let url = try makeAPIURL(path: ["resources"], queryItems: queryItems)
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func capabilities() async throws -> CapabilitiesResponse {
        let url = try makeAPIURL(path: ["auth", "capabilities"])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func organizations() async throws -> OrganizationListResponse {
        let url = try makeAPIURL(path: ["organizations"])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func selectOrganization(id: UUID) async throws -> OrganizationSelectionResponse {
        let url = try makeAPIURL(path: ["organizations", "select"])
        let request = try await jsonRequest(
            url: url,
            method: "POST",
            body: OrganizationSelectionRequest(
                organizationID: id.uuidString.lowercased()
            )
        )
        return try await execute(request)
    }

    public func runtimeSettings() async throws -> RuntimeSettingsResponse {
        let url = try makeServerURL(path: ["api", "settings", "status"])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func inventoryTypes(
        includeArchived: Bool = false
    ) async throws -> InventoryTypesResponse {
        let queryItems = includeArchived
            ? [URLQueryItem(name: "includeArchived", value: "true")]
            : []
        let url = try makeAPIURL(path: ["inventory-types"], queryItems: queryItems)
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func customFieldDefinitions(
        entityType: CustomFieldEntityType? = nil
    ) async throws -> CustomFieldDefinitionsResponse {
        let queryItems = entityType.map {
            [URLQueryItem(name: "entityType", value: $0.rawValue)]
        } ?? []
        let url = try makeAPIURL(path: ["custom-fields"], queryItems: queryItems)
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func customFieldReferenceOptions(
        definitionID: String,
        query: String? = nil,
        selectedIDs: [String] = [],
        limit: Int = 25
    ) async throws -> CustomFieldReferenceOptionsResponse {
        var queryItems = selectedIDs.map { URLQueryItem(name: "selected", value: $0) }
        if let query, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            queryItems.append(URLQueryItem(name: "q", value: query))
        }
        queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        let url = try makeAPIURL(
            path: ["custom-fields", definitionID, "options"],
            queryItems: queryItems
        )
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func imageGenerationModels() async throws -> ImageGenerationModelsResponse {
        let url = try makeAPIURL(path: ["ai", "image-models"])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func objectCountModels() async throws -> ObjectCountModelsResponse {
        let url = try makeAPIURL(path: ["ai", "count-models"])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func listRoomScans() async throws -> SpatialRoomScanListResponse {
        let url = try makeAPIURL(path: ["room-scans"])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func roomScene(scanID: UUID) async throws -> SpatialRoomSceneResponse {
        let url = try makeAPIURL(path: [
            "room-scans",
            scanID.uuidString.lowercased(),
        ])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func uploadRoomScan(
        _ draft: SpatialRoomScanDraft,
        roomResourceID: UUID
    ) async throws -> SpatialRoomScanUploadResponse {
        try Task.checkCancellation()
        let body = try MultipartFormFileBuilder.buildRoomScan(
            draft: draft,
            roomResourceID: roomResourceID
        )
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let url = try makeAPIURL(path: ["room-scans"])
        var request = try await authorizedRequest(url: url, method: "POST")
        request.timeoutInterval = 300
        request.setValue(
            "multipart/form-data; boundary=\(body.boundary)",
            forHTTPHeaderField: "Content-Type"
        )

        do {
            let (data, response) = try await session.upload(for: request, fromFile: body.fileURL)
            return try decodeResponse(data: data, response: response)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            guard Task.isCancelled else {
                throw APIClientError.transport(error.localizedDescription)
            }
            throw CancellationError()
        } catch let error as APIClientError {
            await notifyIfUnauthorized(error, request: request)
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    public func downloadRoomWorldMap(scanID: UUID) async throws -> Data {
        let url = try makeAPIURL(path: [
            "room-scans",
            scanID.uuidString.lowercased(),
            "assets",
            "world_map",
        ])
        var request = try await authorizedRequest(url: url, method: "GET")
        request.setValue("application/vnd.apple.arkit.world-map", forHTTPHeaderField: "Accept")
        return try await executeBytes(request)
    }

    public func downloadRoomKeyframe(scanID: UUID, keyframeID: UUID) async throws -> Data {
        let url = try makeAPIURL(path: [
            "room-scans",
            scanID.uuidString.lowercased(),
            "keyframes",
            keyframeID.uuidString.lowercased(),
        ])
        var request = try await authorizedRequest(url: url, method: "GET")
        request.setValue("image/jpeg", forHTTPHeaderField: "Accept")
        return try await executeBytes(request)
    }

    public func saveSpatialPlacement(
        resourceID: UUID,
        draft: SpatialPlacementDraft
    ) async throws -> SpatialPlacementResponse {
        let url = try makeAPIURL(path: [
            "room-scans",
            draft.roomScanID.uuidString.lowercased(),
            "placements",
            resourceID.uuidString.lowercased(),
        ])
        let request = try await jsonRequest(
            url: url,
            method: "PUT",
            body: SpatialPlacementRequest(draft: draft)
        )
        return try await execute(request)
    }

    public func login(
        email: String,
        password: String,
        deviceName: String? = nil
    ) async throws -> LoginResponse {
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty else {
            throw APIClientError.invalidRequest("E-Mail und Passwort fehlen.")
        }

        let url = try makeAPIURL(path: ["auth", "login"])
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 120
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try Self.makeJSONEncoder().encode(
                LoginRequest(
                    email: normalizedEmail,
                    password: password,
                    deviceName: deviceName
                )
            )
        } catch {
            throw APIClientError.invalidRequest("Die Anmeldung konnte nicht vorbereitet werden.")
        }
        return try await execute(request)
    }

    public func logout() async throws {
        let url = try makeAPIURL(path: ["auth", "logout"])
        let request = try await authorizedRequest(url: url, method: "POST")
        try await executeWithoutResponse(request)
    }

    public func getResource(id: UUID) async throws -> InventoryResource {
        try await getResourceDetail(id: id).resource
    }

    public func getResourceDetail(id: UUID) async throws -> ResourceResponse {
        let url = try makeAPIURL(path: ["resources", id.uuidString.lowercased()])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func resourceFamily(resourceID: UUID) async throws -> ResourceFamilyResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "family",
        ])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func createResourceFamilyVariant(
        resourceID: UUID,
        request input: ResourceFamilyVariantRequest
    ) async throws -> ResourceFamilyVariantResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "family",
        ])
        let request = try await jsonRequest(url: url, method: "POST", body: input)
        return try await execute(request)
    }

    public func attachResourceFamilyVariant(
        resourceID: UUID,
        existingResourceID: UUID
    ) async throws -> ResourceFamilyVariantResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "family",
        ])
        let request = try await jsonRequest(
            url: url,
            method: "POST",
            body: ResourceFamilyAttachRequest(existingResourceId: existingResourceID)
        )
        return try await execute(request)
    }

    public func detachResourceFamilyVariant(
        resourceID: UUID
    ) async throws -> DetachedResourceFamilyResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "family",
        ])
        let request = try await authorizedRequest(url: url, method: "DELETE")
        return try await execute(request)
    }

    public func resourceRelations(
        resourceID: UUID
    ) async throws -> ResourceRelationsResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "relations",
        ])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func relationTypes() async throws -> RelationTypesResponse {
        let url = try makeAPIURL(path: ["relation-types"])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func createResourceRelation(
        resourceID: UUID,
        request input: ResourceRelationCreateRequest
    ) async throws -> ResourceRelationResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "relations",
        ])
        let request = try await jsonRequest(url: url, method: "POST", body: input)
        return try await execute(request)
    }

    public func deleteResourceRelation(
        relationID: UUID,
        resourceID: UUID
    ) async throws {
        let url = try makeAPIURL(
            path: ["relations", relationID.uuidString.lowercased()],
            queryItems: [
                URLQueryItem(
                    name: "resourceId",
                    value: resourceID.uuidString.lowercased()
                ),
            ]
        )
        let request = try await authorizedRequest(url: url, method: "DELETE")
        try await executeWithoutResponse(request)
    }

    public func billOfMaterials(
        resourceID: UUID
    ) async throws -> BillOfMaterialsResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "bom",
        ])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func replaceBillOfMaterials(
        resourceID: UUID,
        components: [BillOfMaterialsComponentRequest]
    ) async throws -> BillOfMaterialsResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "bom",
        ])
        let request = try await jsonRequest(
            url: url,
            method: "PUT",
            body: BillOfMaterialsReplaceRequest(components: components)
        )
        return try await execute(request)
    }

    public func resetBillOfMaterialsOverrides(
        resourceID: UUID
    ) async throws -> BillOfMaterialsResponse {
        let url = try makeAPIURL(path: [
            "resources", resourceID.uuidString.lowercased(), "bom",
        ])
        let request = try await authorizedRequest(url: url, method: "DELETE")
        return try await execute(request)
    }

    public func createResource(
        _ input: ResourceCreateRequest,
        idempotencyKey: UUID? = nil
    ) async throws -> InventoryResource {
        let url = try makeAPIURL(path: ["resources"])
        var request = try await jsonRequest(url: url, method: "POST", body: input)
        setIdempotencyKey(idempotencyKey, on: &request)
        let response: ResourceResponse = try await execute(request)
        return response.resource
    }

    public func patchResource(
        id: UUID,
        with patch: ResourcePatchRequest
    ) async throws -> InventoryResource {
        let url = try makeAPIURL(path: ["resources", id.uuidString.lowercased()])
        let request = try await jsonRequest(url: url, method: "PATCH", body: patch)
        let response: ResourceResponse = try await execute(request)
        return response.resource
    }

    public func deleteResource(id: UUID) async throws {
        let url = try makeAPIURL(path: ["resources", id.uuidString.lowercased()])
        let request = try await authorizedRequest(url: url, method: "DELETE")
        try await executeWithoutResponse(request)
    }

    public func lookupResource(code: String) async throws -> ResourceLookupResponse {
        let parsed = ResourceCodeParser.parse(code)
        guard !parsed.code.isEmpty else {
            throw APIClientError.invalidRequest("The scanned code is empty.")
        }
        guard parsed.code.count <= 2_048 else {
            throw APIClientError.invalidRequest("The scanned code exceeds 2,048 characters.")
        }

        let url = try makeAPIURL(
            path: ["resources", "lookup"],
            queryItems: [URLQueryItem(name: "code", value: parsed.code)]
        )
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func scanActionWorkflows() async throws -> ScanActionWorkflowListResponse {
        let url = try makeAPIURL(path: ["stock", "scan-workflows"])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func resolveScanAction(
        workflowID: UUID,
        code: String,
        codeType: String? = nil
    ) async throws -> ScanActionResolution {
        let normalizedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedCode.isEmpty else {
            throw APIClientError.invalidRequest("Der gescannte Code ist leer.")
        }
        let url = try makeAPIURL(path: ["stock", "scans", "resolve"])
        let body = ScanActionResolveRequest(
            workflowId: workflowID,
            code: normalizedCode,
            codeType: codeType
        )
        let request = try await jsonRequest(url: url, method: "POST", body: body)
        return try await execute(request)
    }

    public func executeScanAction(
        _ body: ScanActionExecuteRequest,
        idempotencyKey: UUID
    ) async throws -> ScanActionExecutionResponse {
        let url = try makeAPIURL(path: ["stock", "scans", "execute"])
        var request = try await jsonRequest(url: url, method: "POST", body: body)
        setIdempotencyKey(idempotencyKey, on: &request)
        return try await execute(request)
    }

    public func uploadMedia(
        resourceID: UUID,
        files: [MediaUploadFile],
        idempotencyKey: UUID? = nil
    ) async throws -> MediaUploadResponse {
        guard (1 ... 12).contains(files.count) else {
            throw APIClientError.invalidUpload("Upload between one and 12 files at a time.")
        }
        try Task.checkCancellation()

        let body = try MultipartFormFileBuilder.build(files: files)
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let url = try makeAPIURL(path: [
            "resources",
            resourceID.uuidString.lowercased(),
            "media",
        ])
        var request = try await authorizedRequest(url: url, method: "POST")
        if files.contains(where: { $0.mimeType == "model/vnd.usdz+zip" }) {
            request.timeoutInterval = 300
        }
        request.setValue(
            "multipart/form-data; boundary=\(body.boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        setIdempotencyKey(idempotencyKey, on: &request)

        do {
            let (data, response) = try await session.upload(for: request, fromFile: body.fileURL)
            return try decodeResponse(data: data, response: response)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as APIClientError {
            await notifyIfUnauthorized(error, request: request)
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    public func analyzeResource(
        id: UUID,
        overwrite: Bool = true,
        prompt: String? = nil,
        idempotencyKey: UUID? = nil
    ) async throws -> AnalyzeResourceResponse {
        let url = try makeAPIURL(path: [
            "resources",
            id.uuidString.lowercased(),
            "analyze",
        ])
        var request = try await jsonRequest(
            url: url,
            method: "POST",
            body: AnalyzeRequest(
                overwrite: overwrite,
                prompt: AIPromptPreferences.validatedPrompt(prompt)
            )
        )
        setIdempotencyKey(idempotencyKey, on: &request)
        return try await execute(request)
    }

    public func recognizeInventoryObject(
        in image: MediaUploadFile,
        idempotencyKey: UUID
    ) async throws -> InventoryRecognitionResponse {
        try Task.checkCancellation()
        let body = try MultipartFormFileBuilder.buildObjectRecognition(image: image)
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let url = try makeAPIURL(path: ["ai", "recognize"])
        var request = try await authorizedRequest(url: url, method: "POST")
        request.timeoutInterval = 150
        request.setValue(
            "multipart/form-data; boundary=\(body.boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        setIdempotencyKey(idempotencyKey, on: &request)

        do {
            let replayDeadline = Date().addingTimeInterval(150)
            while true {
                let (data, response) = try await session.upload(
                    for: request,
                    fromFile: body.fileURL
                )
                if let response = response as? HTTPURLResponse,
                   response.statusCode == 202 {
                    guard Date() < replayDeadline else {
                        throw APIClientError.http(
                            statusCode: 504,
                            message: "Die Objekterkennung dauert zu lange. Bitte versuche es erneut.",
                            retryAfter: nil,
                            terminal: false
                        )
                    }
                    let retryAfter = response.value(forHTTPHeaderField: "Retry-After")
                        .flatMap(TimeInterval.init) ?? 2
                    try await Task.sleep(for: .seconds(min(5, max(1, retryAfter))))
                    try Task.checkCancellation()
                    continue
                }
                return try decodeResponse(data: data, response: response)
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            guard Task.isCancelled else {
                throw APIClientError.transport(error.localizedDescription)
            }
            throw CancellationError()
        } catch let error as APIClientError {
            await notifyIfUnauthorized(error, request: request)
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    public func countObjects(
        in image: MediaUploadFile,
        itemHint: String? = nil,
        itemID: UUID? = nil,
        modelID: String? = nil,
        idempotencyKey: UUID? = nil
    ) async throws -> ObjectCountResponse {
        try Task.checkCancellation()
        let normalizedHint = itemHint?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let normalizedHint, normalizedHint.utf16.count > 240 {
            throw APIClientError.invalidRequest(
                "Der Hinweis zum Zählobjekt darf höchstens 240 Zeichen lang sein."
            )
        }
        let body = try MultipartFormFileBuilder.buildObjectCount(
            image: image,
            itemHint: normalizedHint?.isEmpty == false ? normalizedHint : nil,
            itemID: itemID,
            modelID: modelID
        )
        defer { try? FileManager.default.removeItem(at: body.fileURL) }

        let url = try makeAPIURL(path: ["ai", "count"])
        var request = try await authorizedRequest(url: url, method: "POST")
        // The server only reserves the asynchronous Replicate job here. Keep a
        // finite transport deadline for image normalization and provider setup.
        request.timeoutInterval = Self.objectCountTimeout
        request.setValue(
            "multipart/form-data; boundary=\(body.boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        setIdempotencyKey(idempotencyKey, on: &request)

        do {
            let startRetryDeadline = Date().addingTimeInterval(5)
            while true {
                let (data, response) = try await objectCountSession.upload(
                    for: request,
                    fromFile: body.fileURL
                )
                do {
                    switch try decodeObjectCountStep(data: data, response: response) {
                    case .completed(let result):
                        return result
                    case .processing(let jobToken, let retryAfter, let expiresAt):
                        return try await pollObjectCountJob(
                            jobToken: jobToken,
                            retryAfter: retryAfter,
                            expiresAt: expiresAt
                        )
                    }
                } catch let error as APIClientError
                    where error.statusCode == 409 &&
                          error.retryAfter != nil &&
                          Date() < startRetryDeadline {
                    try await Task.sleep(
                        for: .seconds(min(5, max(1, error.retryAfter ?? 1)))
                    )
                    try Task.checkCancellation()
                    continue
                }
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            guard Task.isCancelled else {
                throw APIClientError.transport(error.localizedDescription)
            }
            throw CancellationError()
        } catch let error as APIClientError {
            await notifyIfUnauthorized(error, request: request)
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    private func pollObjectCountJob(
        jobToken: String,
        retryAfter: TimeInterval,
        expiresAt: Date
    ) async throws -> ObjectCountResponse {
        var deadline = min(
            Date().addingTimeInterval(11 * 60),
            expiresAt.addingTimeInterval(10)
        )
        var currentToken = jobToken
        var delay = min(10, max(1, retryAfter))
        while Date() < deadline {
            try await Task.sleep(for: .seconds(delay))
            try Task.checkCancellation()
            let url = try makeAPIURL(path: ["ai", "count", "jobs"])
            var request = try await jsonRequest(
                url: url,
                method: "POST",
                body: ObjectCountJobRequest(jobToken: currentToken)
            )
            request.timeoutInterval = 15
            do {
                let (data, response) = try await objectCountSession.data(for: request)
                switch try decodeObjectCountStep(data: data, response: response) {
                case .completed(let result):
                    return result
                case .processing(let nextToken, let retryAfter, let expiresAt):
                    currentToken = nextToken
                    delay = min(10, max(1, retryAfter))
                    deadline = min(deadline, expiresAt.addingTimeInterval(10))
                }
            } catch let error as APIClientError
                where [429, 503].contains(error.statusCode ?? 0) &&
                      error.retryAfter != nil {
                delay = min(10, max(1, error.retryAfter ?? 3))
                continue
            } catch let error as URLError {
                guard !Task.isCancelled else { throw CancellationError() }
                if [
                    .timedOut,
                    .networkConnectionLost,
                    .notConnectedToInternet,
                    .cannotConnectToHost,
                    .cannotFindHost,
                    .dnsLookupFailed,
                ].contains(error.code) {
                    continue
                }
                throw error
            }
        }
        throw APIClientError.http(
            statusCode: 504,
            message: "Die Zählung hat zu lange gedauert. Bitte starte sie erneut.",
            retryAfter: nil,
            terminal: true
        )
    }

    private func decodeObjectCountStep(
        data: Data,
        response: URLResponse
    ) throws -> ObjectCountStep {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        if httpResponse.statusCode == 202 {
            let processing: ObjectCountProcessingResponse
            do {
                processing = try Self.makeJSONDecoder().decode(
                    ObjectCountProcessingResponse.self,
                    from: data
                )
            } catch {
                throw APIClientError.decoding(String(describing: error))
            }
            guard processing.status == "processing", !processing.jobToken.isEmpty else {
                throw APIClientError.invalidResponse
            }
            let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After")
                .flatMap(TimeInterval.init) ?? 3
            return .processing(
                jobToken: processing.jobToken,
                retryAfter: retryAfter,
                expiresAt: processing.expiresAt
            )
        }
        let result: ObjectCountResponse = try decodeResponse(
            data: data,
            response: response
        )
        return .completed(result)
    }

    public func generateCover(
        resourceID: UUID,
        sourceMediaID: UUID? = nil,
        prompt: String? = nil,
        modelID: String? = nil,
        maximumImageSize: Int? = nil,
        transparentBackground: Bool = false,
        transparencyMethod: CoverTransparencyMethod? = nil,
        idempotencyKey: UUID? = nil
    ) async throws -> CoverResourceResponse {
        let url = try makeAPIURL(path: [
            "resources",
            resourceID.uuidString.lowercased(),
            "cover",
        ])
        var request = try await jsonRequest(
            url: url,
            method: "POST",
            body: CoverRequest(
                sourceMediaID: sourceMediaID,
                prompt: AIPromptPreferences.validatedPrompt(prompt),
                modelID: modelID,
                maximumImageSize: maximumImageSize,
                transparentBackground: transparentBackground,
                transparencyMethod: transparentBackground
                    ? (transparencyMethod ?? .differenceMatting)
                    : nil
            )
        )
        setIdempotencyKey(idempotencyKey, on: &request)
        return try await execute(request)
    }

    public func bookStockMovement(
        resourceID: UUID,
        delta: Int,
        type: String,
        reason: String? = nil,
        note: String? = nil,
        location: String? = nil,
        occurredAt: Date? = nil,
        idempotencyKey: UUID? = nil
    ) async throws -> StockMovementResponse {
        guard delta != 0 else {
            throw APIClientError.invalidRequest("The stock change must not be zero.")
        }
        let url = try makeAPIURL(path: [
            "resources",
            resourceID.uuidString.lowercased(),
            "stock",
            "movements",
        ])
        var request = try await jsonRequest(
            url: url,
            method: "POST",
            body: StockMovementRequest(
                delta: delta,
                type: type,
                reason: reason,
                note: note,
                location: location,
                occurredAt: occurredAt
            )
        )
        setIdempotencyKey(idempotencyKey, on: &request)
        return try await execute(request)
    }

    public func getStockDetail(resourceID: UUID) async throws -> StockDetailResponse {
        let url = try makeAPIURL(path: [
            "resources",
            resourceID.uuidString.lowercased(),
            "stock",
        ])
        let request = try await authorizedRequest(url: url, method: "GET")
        return try await execute(request)
    }

    public func updateStockConfig(
        resourceID: UUID,
        request input: StockConfigPatchRequest
    ) async throws -> StockConfigUpdateResponse {
        let url = try makeAPIURL(path: [
            "resources",
            resourceID.uuidString.lowercased(),
            "stock",
            "config",
        ])
        let request = try await jsonRequest(url: url, method: "PATCH", body: input)
        return try await execute(request)
    }

    public func createStockUnits(
        resourceID: UUID,
        request input: StockUnitCreateRequest
    ) async throws -> StockUnitCreationResponse {
        let count = input.count ?? input.codes?.count ?? 0
        guard (1 ... 100).contains(count) else {
            throw APIClientError.invalidRequest("Lege zwischen einer und 100 Einheiten an.")
        }
        let url = try makeAPIURL(path: [
            "resources",
            resourceID.uuidString.lowercased(),
            "stock",
            "units",
        ])
        let request = try await jsonRequest(url: url, method: "POST", body: input)
        return try await execute(request)
    }

    public func updateStockUnit(
        resourceID: UUID,
        unitID: UUID,
        request input: StockUnitPatchRequest
    ) async throws -> StockUnitUpdateResponse {
        let url = try makeAPIURL(path: [
            "resources",
            resourceID.uuidString.lowercased(),
            "stock",
            "units",
            unitID.uuidString.lowercased(),
        ])
        let request = try await jsonRequest(url: url, method: "PATCH", body: input)
        return try await execute(request)
    }

    public func resolveMediaURL(_ value: String) throws -> URL {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.invalidRequest("The media URL is empty.")
        }

        if let absoluteURL = URL(string: trimmed), absoluteURL.scheme != nil {
            guard ["http", "https"].contains(absoluteURL.scheme?.lowercased() ?? "") else {
                throw APIClientError.invalidRequest("The media URL must use HTTP or HTTPS.")
            }
            return absoluteURL
        }
        if trimmed.hasPrefix("//"), let scheme = serverURL.scheme,
           let protocolRelativeURL = URL(string: "\(scheme):\(trimmed)") {
            return protocolRelativeURL
        }
        if trimmed.hasPrefix("/") {
            var components = URLComponents()
            components.scheme = serverURL.scheme
            components.host = serverURL.host
            components.port = serverURL.port
            components.percentEncodedPath = trimmed
            guard let url = components.url else {
                throw APIClientError.invalidRequest("The media URL is invalid.")
            }
            return url
        }
        return serverURL.appendingPathComponent(trimmed)
    }

    /// Builds a request suitable for URLSession-backed image loading. Credentials
    /// are never sent to an absolute media URL on another origin.
    public func mediaRequest(for media: InventoryMedia) async throws -> URLRequest {
        let url = try resolveMediaURL(media.url)
        let isProtectedInventoryMedia = isSameOrigin(url)
        var request = URLRequest(
            url: url,
            cachePolicy: isProtectedInventoryMedia
                ? .reloadIgnoringLocalCacheData
                : .returnCacheDataElseLoad,
            timeoutInterval: 60
        )
        request.setValue(media.mimeType, forHTTPHeaderField: "Accept")
        if isProtectedInventoryMedia {
            let token = try await requiredBearerToken()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            setOrganizationHeader(on: &request)
        }
        return request
    }

    public func mediaData(for media: InventoryMedia) async throws -> Data {
        let request = try await mediaRequest(for: media)
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw APIClientError.invalidResponse
            }
            guard (200 ... 299).contains(response.statusCode) else {
                let payload = try? JSONDecoder().decode(ServerErrorResponse.self, from: data)
                let error = APIClientError.http(
                    statusCode: response.statusCode,
                    message: payload?.error ?? HTTPURLResponse.localizedString(
                        forStatusCode: response.statusCode
                    ),
                    retryAfter: response.value(forHTTPHeaderField: "Retry-After")
                        .flatMap(TimeInterval.init)
                )
                await notifyIfUnauthorized(error, request: request)
                throw error
            }
            return data
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as APIClientError {
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    /// Downloads larger media (notably USDZ object scans) to a stable temporary
    /// file without first buffering the complete model in memory.
    public func mediaFile(for media: InventoryMedia) async throws -> URL {
        let request = try await mediaRequest(for: media)
        do {
            let (temporaryURL, response) = try await session.download(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw APIClientError.invalidResponse
            }
            guard (200 ... 299).contains(response.statusCode) else {
                let data = (try? Data(contentsOf: temporaryURL)) ?? Data()
                let payload = try? JSONDecoder().decode(ServerErrorResponse.self, from: data)
                let error = APIClientError.http(
                    statusCode: response.statusCode,
                    message: payload?.error ?? HTTPURLResponse.localizedString(
                        forStatusCode: response.statusCode
                    ),
                    retryAfter: response.value(forHTTPHeaderField: "Retry-After")
                        .flatMap(TimeInterval.init)
                )
                await notifyIfUnauthorized(error, request: request)
                throw error
            }

            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("InventoryMediaPreview", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            let candidateExtension = media.name.split(separator: ".").last
                .map(String.init)?
                .lowercased()
            let safeExtension = candidateExtension.flatMap { value in
                value.count <= 10 && value.allSatisfy(\.isLetter) ? value : nil
            }
            let fileExtension = media.mimeType == "model/vnd.usdz+zip"
                ? "usdz"
                : (safeExtension ?? "bin")
            let destination = directory
                .appendingPathComponent("preview")
                .appendingPathExtension(fileExtension)
            do {
                try FileManager.default.moveItem(at: temporaryURL, to: destination)
                return destination
            } catch {
                try? FileManager.default.removeItem(at: directory)
                throw error
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as APIClientError {
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    private func execute<Response: Decodable & Sendable>(
        _ request: URLRequest
    ) async throws -> Response {
        do {
            let (data, response) = try await session.data(for: request)
            return try decodeResponse(data: data, response: response)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as APIClientError {
            await notifyIfUnauthorized(error, request: request)
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    private func executeBytes(_ request: URLRequest) async throws -> Data {
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw APIClientError.invalidResponse
            }
            guard (200 ... 299).contains(response.statusCode) else {
                let payload = try? JSONDecoder().decode(ServerErrorResponse.self, from: data)
                throw APIClientError.http(
                    statusCode: response.statusCode,
                    message: payload?.error ?? HTTPURLResponse.localizedString(
                        forStatusCode: response.statusCode
                    ),
                    retryAfter: response.value(forHTTPHeaderField: "Retry-After")
                        .flatMap(TimeInterval.init)
                )
            }
            return data
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as APIClientError {
            await notifyIfUnauthorized(error, request: request)
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    private func executeWithoutResponse(_ request: URLRequest) async throws {
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw APIClientError.invalidResponse
            }
            guard (200 ... 299).contains(response.statusCode) else {
                let payload = try? JSONDecoder().decode(ServerErrorResponse.self, from: data)
                let message = payload?.error ?? HTTPURLResponse.localizedString(
                    forStatusCode: response.statusCode
                )
                let retryAfter = response.value(forHTTPHeaderField: "Retry-After")
                    .flatMap(TimeInterval.init)
                throw APIClientError.http(
                    statusCode: response.statusCode,
                    message: message,
                    retryAfter: retryAfter
                )
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as APIClientError {
            await notifyIfUnauthorized(error, request: request)
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }

    private func decodeResponse<Response: Decodable & Sendable>(
        data: Data,
        response: URLResponse
    ) throws -> Response {
        guard let response = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        if response.statusCode == 202 {
            let payload = try? JSONDecoder().decode(ServerErrorResponse.self, from: data)
            let retryAfter = response.value(forHTTPHeaderField: "Retry-After")
                .flatMap(TimeInterval.init)
            throw APIClientError.http(
                statusCode: 202,
                message: payload?.error ?? "The operation is still being processed.",
                retryAfter: retryAfter
            )
        }
        guard (200 ... 299).contains(response.statusCode) else {
            let payload = try? JSONDecoder().decode(ServerErrorResponse.self, from: data)
            let message = payload?.error ?? HTTPURLResponse.localizedString(
                forStatusCode: response.statusCode
            )
            let retryAfter = response.value(forHTTPHeaderField: "Retry-After")
                .flatMap(TimeInterval.init)
            throw APIClientError.http(
                statusCode: response.statusCode,
                message: message,
                retryAfter: retryAfter,
                terminal: payload?.terminal ?? false
            )
        }

        do {
            return try Self.makeJSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIClientError.decoding(String(describing: error))
        }
    }

    private func jsonRequest<Body: Encodable & Sendable>(
        url: URL,
        method: String,
        body: Body
    ) async throws -> URLRequest {
        var request = try await authorizedRequest(url: url, method: method)
        do {
            request.httpBody = try Self.makeJSONEncoder().encode(body)
        } catch {
            throw APIClientError.invalidRequest(
                "The request could not be encoded: \(error.localizedDescription)"
            )
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func authorizedRequest(url: URL, method: String) async throws -> URLRequest {
        let token = try await requiredBearerToken()
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 120
        )
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        setOrganizationHeader(on: &request)
        return request
    }

    private func setOrganizationHeader(on request: inout URLRequest) {
        guard let organizationID else { return }
        request.setValue(
            organizationID.uuidString.lowercased(),
            forHTTPHeaderField: "X-Organization-ID"
        )
    }

    private func requiredBearerToken() async throws -> String {
        let token = try await credentialStore.loadBearerToken()?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let token, !token.isEmpty else {
            throw APIClientError.missingCredential
        }
        return token
    }

    private func notifyIfUnauthorized(
        _ error: APIClientError,
        request: URLRequest
    ) async {
        guard error.statusCode == 401,
              request.value(forHTTPHeaderField: "Authorization") != nil else { return }
        await onUnauthorized?()
    }

    private func setIdempotencyKey(_ key: UUID?, on request: inout URLRequest) {
        guard let key else { return }
        request.setValue(key.uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key")
    }

    private func makeAPIURL(
        path: [String],
        queryItems: [URLQueryItem] = []
    ) throws -> URL {
        let url = path.reduce(apiBaseURL) { partialURL, component in
            partialURL.appendingPathComponent(component)
        }
        guard !queryItems.isEmpty else { return url }

        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidRequest("The API URL could not be created.")
        }
        components.queryItems = queryItems
        guard let result = components.url else {
            throw APIClientError.invalidRequest("The API URL could not be created.")
        }
        return result
    }

    private func makeServerURL(
        path: [String],
        queryItems: [URLQueryItem] = []
    ) throws -> URL {
        let url = path.reduce(serverURL) { partialURL, component in
            partialURL.appendingPathComponent(component)
        }
        guard !queryItems.isEmpty else { return url }

        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidRequest("The server URL could not be created.")
        }
        components.queryItems = queryItems
        guard let result = components.url else {
            throw APIClientError.invalidRequest("The server URL could not be created.")
        }
        return result
    }

    private func isSameOrigin(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == serverURL.scheme?.lowercased(),
              url.host?.lowercased() == serverURL.host?.lowercased() else {
            return false
        }
        return effectivePort(of: url) == effectivePort(of: serverURL)
    }

    private func effectivePort(of url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }

    private static func normalizeServerURL(_ url: URL) -> URL? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = components.host?.lowercased(),
              components.user == nil,
              components.password == nil else {
            return nil
        }
        if scheme == "http" {
            let isLocalDevelopmentHost = host == "localhost" || host == "127.0.0.1" ||
                host == "::1" || host.hasSuffix(".local")
            guard isLocalDevelopmentHost else { return nil }
        }
        components.scheme = scheme
        components.query = nil
        components.fragment = nil
        while components.path.count > 1, components.path.hasSuffix("/") {
            components.path.removeLast()
        }
        let apiSuffix = "/api/v1"
        if components.path.lowercased().hasSuffix(apiSuffix) {
            components.path.removeLast(apiSuffix.count)
            if components.path.isEmpty { components.path = "/" }
        }
        return components.url
    }

    private static func makeSecureSession(
        for serverURL: URL,
        requestTimeout: TimeInterval = 120,
        resourceTimeout: TimeInterval = 300
    ) -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = requestTimeout
        configuration.timeoutIntervalForResource = resourceTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpMaximumConnectionsPerHost = 2
        return URLSession(
            configuration: configuration,
            delegate: SameOriginRedirectDelegate(allowedOrigin: serverURL),
            delegateQueue: nil
        )
    }

    private static func makeObjectCountSession(
        for serverURL: URL,
        basedOn sourceConfiguration: URLSessionConfiguration
    ) -> URLSession {
        let configuration = sourceConfiguration
        configuration.timeoutIntervalForRequest = objectCountTimeout
        configuration.timeoutIntervalForResource = objectCountTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(
            configuration: configuration,
            delegate: SameOriginRedirectDelegate(allowedOrigin: serverURL),
            delegateQueue: nil
        )
    }

    private static func makeJSONDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) {
                return date
            }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO-8601 date: \(value)"
            )
        }
        return decoder
    }

    private static func makeJSONEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }
}

/// URLSession otherwise follows redirects automatically, including redirects
/// that can replay an authenticated 307/308 request. API and login traffic may
/// only follow redirects that keep scheme, host, and effective port unchanged.
final class SameOriginRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let allowedOrigin: URL

    init(allowedOrigin: URL) {
        self.allowedOrigin = allowedOrigin
    }

    func allowsRedirect(to url: URL) -> Bool {
        Self.sameOrigin(url, allowedOrigin)
    }

    func redirectedRequest(
        from originalRequest: URLRequest,
        to proposedRequest: URLRequest
    ) -> URLRequest? {
        guard let originalURL = originalRequest.url,
              let proposedURL = proposedRequest.url else { return nil }
        let carriesCredential = originalRequest.value(
            forHTTPHeaderField: "Authorization"
        ) != nil
        if carriesCredential || Self.sameOrigin(originalURL, allowedOrigin) {
            return Self.sameOrigin(proposedURL, allowedOrigin) ? proposedRequest : nil
        }

        // External media requests do not carry inventory credentials. They may
        // follow CDN redirects, but never to plaintext HTTP.
        return proposedURL.scheme?.lowercased() == "https" ? proposedRequest : nil
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        guard let originalRequest = task.originalRequest,
              let redirectedRequest = redirectedRequest(
                  from: originalRequest,
                  to: request
              ) else {
            completionHandler(nil)
            return
        }
        completionHandler(redirectedRequest)
    }

    private static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased() &&
            lhs.host?.lowercased() == rhs.host?.lowercased() &&
            effectivePort(of: lhs) == effectivePort(of: rhs)
    }

    private static func effectivePort(of url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }
}

struct AnalyzeRequest: Encodable, Sendable {
    let overwrite: Bool
    let prompt: String?
}

private enum ObjectCountStep {
    case completed(ObjectCountResponse)
    case processing(jobToken: String, retryAfter: TimeInterval, expiresAt: Date)
}

private struct ObjectCountProcessingResponse: Decodable {
    let status: String
    let jobToken: String
    let expiresAt: Date
}

private struct ObjectCountJobRequest: Encodable, Sendable {
    let jobToken: String
}

private struct LoginRequest: Encodable, Sendable {
    let email: String
    let password: String
    let deviceName: String?
}

struct OrganizationSelectionRequest: Encodable, Sendable {
    let organizationID: String

    private enum CodingKeys: String, CodingKey {
        case organizationID = "organizationId"
    }
}

public enum CoverTransparencyMethod: String, Codable, Sendable {
    case greenscreen
    case differenceMatting = "difference-matting"
}

struct CoverRequest: Encodable, Sendable {
    let sourceMediaID: UUID?
    let prompt: String?
    let modelID: String?
    let maximumImageSize: Int?
    let transparentBackground: Bool
    let transparencyMethod: CoverTransparencyMethod?

    init(
        sourceMediaID: UUID?,
        prompt: String?,
        modelID: String?,
        maximumImageSize: Int? = nil,
        transparentBackground: Bool,
        transparencyMethod: CoverTransparencyMethod?
    ) {
        self.sourceMediaID = sourceMediaID
        self.prompt = prompt
        self.modelID = modelID
        self.maximumImageSize = maximumImageSize
        self.transparentBackground = transparentBackground
        self.transparencyMethod = transparencyMethod
    }

    private enum CodingKeys: String, CodingKey {
        case sourceMediaID = "sourceMediaId"
        case prompt
        case modelID = "modelId"
        case maximumImageSize
        case transparentBackground
        case transparencyMethod
    }
}

private struct ServerErrorResponse: Decodable {
    let error: String?
    let terminal: Bool?
}

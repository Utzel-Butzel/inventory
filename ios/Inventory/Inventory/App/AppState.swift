import CryptoKit
import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published private(set) var serverAddress: String
    @Published private(set) var hasStoredToken = false
    @Published private(set) var client: APIClient?
    @Published private(set) var configurationError: String?
    @Published private(set) var grantedScopes: Set<String> = []
    @Published private(set) var grantedPermissions: Set<String> = []
    @Published private(set) var organizations: [InventoryOrganization] = []
    @Published private(set) var activeOrganization: InventoryOrganization?
    @Published private(set) var isSwitchingOrganization = false
    @Published private(set) var availableImageModels: [ImageGenerationModelOption] = []
    @Published private(set) var defaultImageModelID: String?
    @Published private(set) var selectedImageModelID: String?
    @Published private(set) var aiCostEstimates: [String: AICostEstimate] = [:]
    @Published private(set) var maximumUploadImagePixelSize: Int
    @Published private(set) var maximumAIGeneratedImagePixelSize: Int
    @Published private(set) var analysisPrompt: String?
    @Published private(set) var coverPrompt: String?
    @Published private(set) var transparentCoverPrompt: String?
    @Published var selectedTab: RootTab = .inventory
    @Published var presentedTool: PresentedTool?
    @Published var pendingScanCode: String?
    @Published var pendingCaptureCode: String?

    let intakeQueue = IntakeQueue()

    private let credentialStore: any CredentialStore
    private let defaults: UserDefaults
    private let serverKey = "inventory.serverURL"
    private let scopesKey = "inventory.tokenScopes"
    private let authenticationMethodKey = "inventory.authenticationMethod"
    private let tokenExpiresAtKey = "inventory.tokenExpiresAt"
    private let organizationPreferencesKey = "inventory.organizationPreferences"
    private let imageModelPreferencesKey = "inventory.imageGenerationModelPreferences"
    private var authenticationMethod: StoredAuthenticationMethod?
    private var tokenExpiresAt: Date?
    private var currentToken: String?
    private var activeClientID = UUID()
    private var authenticationOperationID = UUID()
    private var isVerifyingStoredCredential = false
    private var hasGranularPermissions = false

    init(
        credentialStore: any CredentialStore = KeychainCredentialStore(),
        defaults: UserDefaults = .standard
    ) {
        self.credentialStore = credentialStore
        self.defaults = defaults
        self.serverAddress = defaults.string(forKey: serverKey) ?? ""
        self.maximumUploadImagePixelSize = ImageSizePreferences
            .maximumUploadImagePixelSize(in: defaults)
        self.maximumAIGeneratedImagePixelSize = ImageSizePreferences
            .maximumAIGeneratedImagePixelSize(in: defaults)
        self.analysisPrompt = nil
        self.coverPrompt = nil
        self.transparentCoverPrompt = nil
        self.authenticationMethod = defaults.string(forKey: authenticationMethodKey)
            .flatMap(StoredAuthenticationMethod.init(rawValue:))
        self.tokenExpiresAt = defaults.object(forKey: tokenExpiresAtKey) as? Date
        Task { await restoreConfiguration() }
    }

    var isConfigured: Bool { client != nil && hasStoredToken }
    var canReadInventory: Bool { allows("inventory.read", legacyScope: "read") }
    var canCreateInventory: Bool { allows("inventory.create", legacyScope: "write") }
    var canUpdateInventory: Bool { allows("inventory.update", legacyScope: "write") }
    var canDeleteInventory: Bool { allows("inventory.delete", legacyScope: "write") }
    var canReadStock: Bool { allows("stock.read", legacyScope: "read") }
    var canManageStock: Bool { allows("stock.manage", legacyScope: "write") }
    var canReadSpatial: Bool { allows("spatial.read", legacyScope: "read") }
    var canManageSpatial: Bool { allows("spatial.manage", legacyScope: "write") }
    var canUseAI: Bool {
        hasGranularPermissions
            ? grantedPermissions.contains { $0.hasPrefix("ai.") }
            : grantedScopes.contains("ai")
    }
    var canAnalyzeInventory: Bool { allows("ai.analyze", legacyScope: "ai") }
    var canResearchInventory: Bool { allows("ai.research", legacyScope: "ai") }
    var canGenerateInventoryImages: Bool { allows("ai.images", legacyScope: "ai") }
    var canTranslateInventory: Bool { allows("ai.translate", legacyScope: "ai") }
    var canCaptureInventory: Bool { canCreateInventory && canUpdateInventory }
    var canWrite: Bool {
        canCreateInventory || canUpdateInventory || canDeleteInventory ||
            canManageStock || canManageSpatial
    }
    var allowsNegativeStock: Bool { activeOrganization?.allowNegativeStock ?? false }
    var organizationContextIdentifier: String { client?.contextIdentifier ?? "unconfigured" }

    func aiCostEstimate(for operation: String) -> AICostRange? {
        aiCostEstimates[operation]?.range
    }

    func imageGenerationCostEstimate(passes: Int = 1) -> AICostRange? {
        let effectiveModel = selectedImageModelID.flatMap { selectedID in
            availableImageModels.first(where: { $0.id == selectedID })
        } ?? defaultImageModelID.flatMap { defaultID in
            availableImageModels.first(where: { $0.id == defaultID })
        }
        guard let effectiveModel else { return nil }
        let estimate = effectiveModel.estimatedCostsBySize?[
            String(maximumAIGeneratedImagePixelSize)
        ] ?? effectiveModel.estimatedCost
        return estimate?.multiplied(by: Double(max(1, passes)))
    }

    nonisolated static func supportsInventory(scopes: Set<String>) -> Bool {
        scopes.contains("read")
    }

    func selectImageModel(_ modelID: String?) {
        guard let client else { return }
        let normalized = modelID?.trimmingCharacters(in: .whitespacesAndNewlines)
        let selection = normalized.flatMap { $0.isEmpty ? nil : $0 }
        guard selection == nil || availableImageModels.contains(where: { $0.id == selection }) else {
            return
        }

        selectedImageModelID = selection
        var preferences = defaults.dictionary(forKey: imageModelPreferencesKey)?
            .compactMapValues { $0 as? String } ?? [:]
        if let selection {
            preferences[client.contextIdentifier] = selection
        } else {
            preferences.removeValue(forKey: client.contextIdentifier)
        }
        if preferences.isEmpty {
            defaults.removeObject(forKey: imageModelPreferencesKey)
        } else {
            defaults.set(preferences, forKey: imageModelPreferencesKey)
        }
    }

    func setMaximumUploadImagePixelSize(_ pixelSize: Int) {
        maximumUploadImagePixelSize = ImageSizePreferences
            .setMaximumUploadImagePixelSize(pixelSize, in: defaults)
    }

    func setMaximumAIGeneratedImagePixelSize(_ pixelSize: Int) {
        maximumAIGeneratedImagePixelSize = ImageSizePreferences
            .setMaximumAIGeneratedImagePixelSize(pixelSize, in: defaults)
    }

    func setAnalysisPrompt(_ prompt: String?) {
        guard let contextIdentifier = client?.contextIdentifier else { return }
        analysisPrompt = AIPromptPreferences.setAnalysisPrompt(
            prompt,
            for: contextIdentifier,
            in: defaults
        )
    }

    func setCoverPrompt(_ prompt: String?) {
        guard let contextIdentifier = client?.contextIdentifier else { return }
        coverPrompt = AIPromptPreferences.setCoverPrompt(
            prompt,
            for: contextIdentifier,
            in: defaults
        )
    }

    func setTransparentCoverPrompt(_ prompt: String?) {
        guard let contextIdentifier = client?.contextIdentifier else { return }
        transparentCoverPrompt = AIPromptPreferences
            .setTransparentCoverPrompt(
                prompt,
                for: contextIdentifier,
                in: defaults
            )
    }

    @discardableResult
    func saveConfiguration(server: String, token: String?) async throws -> ResourceListResponse {
        let operationID = beginAuthenticationOperation()
        let url = try serverURL(from: server)
        let normalizedURL = try makeClient(serverURL: url, token: nil).serverURL

        let submittedToken = token?.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidateToken: String
        let candidateMethod: StoredAuthenticationMethod
        let candidateExpiration: Date?
        if let submittedToken, !submittedToken.isEmpty {
            candidateToken = submittedToken
            candidateMethod = .apiToken
            candidateExpiration = nil
        } else if let storedToken = try await credentialStore.loadBearerToken(),
                  !storedToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try ensureCurrent(operationID)
            guard let storedURL = URL(string: serverAddress),
                  sameOrigin(normalizedURL, storedURL) else {
                throw APIClientError.missingCredential
            }
            if authenticationMethod == .login, isLoginExpired {
                await clearLocalCredential(
                    matching: storedToken,
                    message: nil,
                    expectedOperationID: operationID
                )
                throw APIClientError.missingCredential
            }
            candidateToken = storedToken.trimmingCharacters(in: .whitespacesAndNewlines)
            candidateMethod = authenticationMethod ?? .apiToken
            candidateExpiration = tokenExpiresAt
        } else {
            throw APIClientError.missingCredential
        }

        return try await validateAndActivate(
            serverURL: url,
            token: candidateToken,
            method: candidateMethod,
            expiresAt: candidateExpiration,
            operationID: operationID
        )
    }

    @discardableResult
    func login(server: String, email: String, password: String) async throws -> ResourceListResponse {
        let operationID = beginAuthenticationOperation()
        let url = try serverURL(from: server)
        let bootstrapClient = try makeClient(serverURL: url, token: nil)
        let response = try await bootstrapClient.login(
            email: email,
            password: password,
            deviceName: "Inventory iOS"
        )
        let token = response.token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, response.expiresAt > Date() else {
            throw APIClientError.invalidResponse
        }

        do {
            try ensureCurrent(operationID)
            return try await validateAndActivate(
                serverURL: url,
                token: token,
                method: .login,
                expiresAt: response.expiresAt,
                operationID: operationID
            )
        } catch {
            await revokeBestEffort(serverURL: url, token: token)
            throw error
        }
    }

    private func validateAndActivate(
        serverURL: URL,
        token: String,
        method: StoredAuthenticationMethod,
        expiresAt: Date?,
        operationID: UUID
    ) async throws -> ResourceListResponse {
        let previousCredential = credentialSnapshot
        let bootstrapClient = try makeClient(serverURL: serverURL, token: token)
        let organizationContext = try await resolveOrganizationContext(
            using: bootstrapClient,
            token: token
        )

        try ensureCurrent(operationID)
        let candidateScopes = Set(organizationContext.capabilities.scopes)
        let candidatePermissions = Set(organizationContext.capabilities.permissions ?? [])
        let candidateHasGranularPermissions = organizationContext.capabilities.permissions != nil
        guard Self.supportsInventory(scopes: candidateScopes) else {
            throw APIClientError.invalidRequest("Dieses Konto darf Inventar nicht anzeigen.")
        }
        let testResult = try await organizationContext.client.listResources(page: 1, pageSize: 1)
        try ensureCurrent(operationID)

        var previousLoginWasRevoked = false
        if let previousCredential,
           previousCredential.method == .login,
           isCredentialSwitch(
               from: previousCredential,
               toServerURL: organizationContext.client.serverURL,
               token: token
           ) {
            let previousClient = try makeClient(
                serverURL: previousCredential.serverURL,
                token: previousCredential.token
            )
            do {
                try await previousClient.logout()
            } catch let error as APIClientError where error.statusCode == 401 {
                // The old device credential is already invalid, so switching is safe.
            } catch {
                throw error
            }
            previousLoginWasRevoked = true
            do {
                try ensureCurrent(operationID)
            } catch {
                await clearRevokedCredentialIfCurrent(previousCredential)
                throw error
            }
        }

        do {
            try await credentialStore.saveBearerToken(token)
            try ensureCurrent(operationID)
        } catch {
            if authenticationOperationID != operationID {
                _ = try? await credentialStore.deleteBearerToken(matching: token)
            }
            if previousLoginWasRevoked, let previousCredential {
                await clearRevokedCredentialIfCurrent(previousCredential)
            }
            throw error
        }

        let (nextClient, nextClientID) = try makeActiveClient(
            serverURL: organizationContext.client.serverURL,
            token: token,
            organizationID: organizationContext.activeOrganization?.id,
            principalIdentifier: organizationContext.principalIdentifier
        )
        defaults.set(nextClient.serverURL.absoluteString, forKey: serverKey)
        defaults.set(Array(candidateScopes).sorted(), forKey: scopesKey)
        defaults.set(method.rawValue, forKey: authenticationMethodKey)
        if let expiresAt {
            defaults.set(expiresAt, forKey: tokenExpiresAtKey)
        } else {
            defaults.removeObject(forKey: tokenExpiresAtKey)
        }
        serverAddress = nextClient.serverURL.absoluteString
        hasStoredToken = true
        grantedScopes = candidateScopes
        grantedPermissions = candidatePermissions
        hasGranularPermissions = candidateHasGranularPermissions
        organizations = organizationContext.organizations
        activeOrganization = organizationContext.activeOrganization
        rememberActiveOrganization(
            organizationContext.activeOrganization,
            for: nextClient.serverURL
        )
        authenticationMethod = method
        tokenExpiresAt = expiresAt
        currentToken = token
        activeClientID = nextClientID
        client = nextClient
        selectedTab = .inventory
        presentedTool = nil
        pendingScanCode = nil
        pendingCaptureCode = nil
        configurationError = nil
        intakeQueue.configure(
            client: nextClient,
            canWrite: canProcessIntakeQueue(
                scopes: candidateScopes,
                permissions: candidatePermissions,
                hasGranularPermissions: candidateHasGranularPermissions
            )
        )
        scheduleImageModelDiscovery(
            using: nextClient,
            activeClient: nextClient,
            scopes: candidateScopes
        )
        return testResult
    }

    func testConnection() async throws -> ResourceListResponse {
        guard let client else { throw APIClientError.missingCredential }
        return try await client.listResources(page: 1, pageSize: 1)
    }

    func switchOrganization(to organizationID: UUID) async throws {
        guard activeOrganization?.id != organizationID else { return }
        guard organizations.contains(where: { $0.id == organizationID }),
              let token = currentToken,
              let serverURL = URL(string: serverAddress) else {
            throw APIClientError.invalidRequest("Die Organisation ist nicht verfügbar.")
        }

        let operationID = beginAuthenticationOperation()
        isSwitchingOrganization = true
        defer { isSwitchingOrganization = false }

        let bootstrapClient = try makeClient(serverURL: serverURL, token: token)
        let selection = try await bootstrapClient.selectOrganization(id: organizationID)
        try ensureCurrent(operationID)
        guard selection.organization.id == organizationID else {
            throw APIClientError.invalidResponse
        }

        let nextOrganizations = normalizedOrganizations(
            organizations.map { organization in
                organization.id == selection.organization.id
                    ? selection.organization
                    : organization
            }
        )
        guard nextOrganizations.contains(where: { $0.id == organizationID }) else {
            throw APIClientError.invalidRequest("Du bist kein Mitglied dieser Organisation.")
        }
        let nextOrganization = selection.organization

        let validationClient = try makeClient(
            serverURL: serverURL,
            token: token,
            organizationID: organizationID
        )
        let capabilities = try await validationClient.capabilities()
        let nextScopes = Set(capabilities.scopes)
        let nextPermissions = Set(capabilities.permissions ?? [])
        let nextHasGranularPermissions = capabilities.permissions != nil
        guard Self.supportsInventory(scopes: nextScopes) else {
            throw APIClientError.invalidRequest("Dieses Konto darf Inventar nicht anzeigen.")
        }
        _ = try await validationClient.listResources(page: 1, pageSize: 1)
        try ensureCurrent(operationID)

        let (nextClient, nextClientID) = try makeActiveClient(
            serverURL: serverURL,
            token: token,
            organizationID: organizationID,
            principalIdentifier: principalIdentifier(
                from: capabilities,
                token: token
            )
        )
        organizations = nextOrganizations
        activeOrganization = capabilities.activeOrganization ?? nextOrganization
        rememberActiveOrganization(nextOrganization, for: nextClient.serverURL)
        grantedScopes = nextScopes
        grantedPermissions = nextPermissions
        hasGranularPermissions = nextHasGranularPermissions
        defaults.set(Array(nextScopes).sorted(), forKey: scopesKey)
        activeClientID = nextClientID
        client = nextClient
        selectedTab = .inventory
        presentedTool = nil
        pendingScanCode = nil
        pendingCaptureCode = nil
        configurationError = nil
        intakeQueue.configure(
            client: nextClient,
            canWrite: canProcessIntakeQueue(
                scopes: nextScopes,
                permissions: nextPermissions,
                hasGranularPermissions: nextHasGranularPermissions
            )
        )
        scheduleImageModelDiscovery(
            using: nextClient,
            activeClient: nextClient,
            scopes: nextScopes
        )
    }

    func disconnect() async throws {
        let operationID = beginAuthenticationOperation()
        guard let token = currentToken else {
            try await credentialStore.deleteBearerToken()
            clearCredentialState(message: nil)
            return
        }

        let currentClient = client
        let currentClientID = activeClientID
        intakeQueue.configure(client: nil)

        if authenticationMethod == .login {
            guard let currentClient else {
                let error = APIClientError.transport("Abmeldung derzeit nicht möglich.")
                configurationError = error.localizedDescription
                throw error
            }
            do {
                try await currentClient.logout()
            } catch let error as APIClientError where error.statusCode == 401 {
                await clearLocalCredential(matching: token, message: nil)
                return
            } catch {
                if authenticationOperationID == operationID,
                   activeClientID == currentClientID,
                   self.client === currentClient {
                    intakeQueue.configure(client: currentClient, canWrite: canCaptureInventory)
                    configurationError = error.localizedDescription
                }
                throw error
            }
            guard authenticationOperationID == operationID else { return }
            await clearLocalCredential(
                matching: token,
                message: nil,
                expectedOperationID: operationID
            )
            return
        }

        do {
            _ = try await credentialStore.deleteBearerToken(matching: token)
            try ensureCurrent(operationID)
            guard currentToken == token else { return }
            activeClientID = UUID()
            clearCredentialState(message: nil)
        } catch {
            if authenticationOperationID == operationID,
               activeClientID == currentClientID,
               let currentClient {
                intakeQueue.configure(
                    client: currentClient,
                    canWrite: canCaptureInventory
                )
                configurationError = error.localizedDescription
            }
            throw error
        }
    }

    func resumeUploads() {
        if authenticationMethod == .login, isLoginExpired {
            intakeQueue.configure(client: nil)
            if let currentToken {
                Task { await clearLocalCredential(matching: currentToken, message: nil) }
            }
            return
        }
        if let client {
            intakeQueue.configure(client: client, canWrite: canCaptureInventory)
            return
        }
        guard hasStoredToken else { return }
        intakeQueue.configure(client: nil)
        Task { await verifyStoredCredentialIfNeeded() }
    }

    private func restoreConfiguration() async {
        let operationID = beginAuthenticationOperation()
        intakeQueue.configure(client: nil)
        do {
            guard let token = try await credentialStore.loadBearerToken(),
                  !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let url = URL(string: serverAddress),
                  !serverAddress.isEmpty else { return }
            try ensureCurrent(operationID)
            currentToken = token
            hasStoredToken = true
            client = nil
            grantedScopes = []
            grantedPermissions = []
            hasGranularPermissions = false

            if authenticationMethod == .login, isLoginExpired {
                await clearLocalCredential(
                    matching: token,
                    message: nil,
                    expectedOperationID: operationID
                )
                return
            }
            await verifyStoredCredential(
                token: token,
                serverURL: url,
                operationID: operationID
            )
        } catch is CancellationError {
            return
        } catch {
            if authenticationOperationID == operationID {
                configurationError = error.localizedDescription
            }
        }
    }

    private func verifyStoredCredentialIfNeeded() async {
        guard !isVerifyingStoredCredential,
              let token = currentToken,
              let url = URL(string: serverAddress),
              hasStoredToken else { return }
        await verifyStoredCredential(
            token: token,
            serverURL: url,
            operationID: authenticationOperationID
        )
    }

    private func verifyStoredCredential(
        token: String,
        serverURL: URL,
        operationID: UUID
    ) async {
        guard !isVerifyingStoredCredential else { return }
        isVerifyingStoredCredential = true
        defer { isVerifyingStoredCredential = false }

        do {
            let bootstrapClient = try makeClient(serverURL: serverURL, token: token)
            let organizationContext = try await resolveOrganizationContext(
                using: bootstrapClient,
                token: token
            )
            try ensureCurrent(operationID)
            guard currentToken == token else { throw CancellationError() }
            let scopes = Set(organizationContext.capabilities.scopes)
            let permissions = Set(organizationContext.capabilities.permissions ?? [])
            let receivedGranularPermissions = organizationContext.capabilities.permissions != nil
            guard Self.supportsInventory(scopes: scopes) else {
                throw APIClientError.invalidRequest("Dieses Konto darf Inventar nicht anzeigen.")
            }
            let (restoredClient, restoredClientID) = try makeActiveClient(
                serverURL: organizationContext.client.serverURL,
                token: token,
                organizationID: organizationContext.activeOrganization?.id,
                principalIdentifier: organizationContext.principalIdentifier
            )
            activeClientID = restoredClientID
            client = restoredClient
            hasStoredToken = true
            grantedScopes = scopes
            grantedPermissions = permissions
            hasGranularPermissions = receivedGranularPermissions
            organizations = organizationContext.organizations
            activeOrganization = organizationContext.activeOrganization
            rememberActiveOrganization(
                organizationContext.activeOrganization,
                for: restoredClient.serverURL
            )
            defaults.set(Array(scopes).sorted(), forKey: scopesKey)
            configurationError = nil
            intakeQueue.configure(
                client: restoredClient,
                canWrite: canProcessIntakeQueue(
                    scopes: scopes,
                    permissions: permissions,
                    hasGranularPermissions: receivedGranularPermissions
                )
            )
            scheduleImageModelDiscovery(
                using: restoredClient,
                activeClient: restoredClient,
                scopes: scopes
            )
        } catch is CancellationError {
            return
        } catch let error as APIClientError where error.statusCode == 401 {
            guard authenticationOperationID == operationID else { return }
            await clearLocalCredential(
                matching: token,
                message: "Bitte erneut anmelden.",
                expectedOperationID: operationID
            )
        } catch {
            guard authenticationOperationID == operationID else { return }
            client = nil
            grantedScopes = []
            grantedPermissions = []
            hasGranularPermissions = false
            organizations = []
            activeOrganization = nil
            resetImageModelState()
            configurationError = error.localizedDescription
            intakeQueue.configure(client: nil)
        }
    }

    private func handleUnauthorized(clientID: UUID, token: String) async {
        guard activeClientID == clientID, currentToken == token else { return }
        await clearLocalCredential(
            matching: token,
            message: "Bitte erneut anmelden.",
            expectedClientID: clientID
        )
    }

    private func clearLocalCredential(
        matching token: String,
        message: String?,
        expectedOperationID: UUID? = nil,
        expectedClientID: UUID? = nil
    ) async {
        if let expectedOperationID,
           authenticationOperationID != expectedOperationID { return }
        if let expectedClientID, activeClientID != expectedClientID { return }
        guard currentToken == token else { return }

        authenticationOperationID = UUID()
        activeClientID = UUID()
        clearCredentialState(message: message)
        let deletionGeneration = authenticationOperationID
        do {
            try await credentialStore.deleteBearerToken(matching: token)
        } catch {
            if authenticationOperationID == deletionGeneration, currentToken == nil {
                configurationError = error.localizedDescription
            }
        }
    }

    private func clearRevokedCredentialIfCurrent(_ credential: CredentialSnapshot) async {
        guard currentToken == credential.token else { return }
        activeClientID = UUID()
        clearCredentialState(message: nil)
        _ = try? await credentialStore.deleteBearerToken(matching: credential.token)
    }

    private func clearCredentialState(message: String?) {
        intakeQueue.configure(client: nil)
        defaults.removeObject(forKey: scopesKey)
        defaults.removeObject(forKey: authenticationMethodKey)
        defaults.removeObject(forKey: tokenExpiresAtKey)
        hasStoredToken = false
        grantedScopes = []
        grantedPermissions = []
        hasGranularPermissions = false
        organizations = []
        activeOrganization = nil
        isSwitchingOrganization = false
        resetImageModelState()
        authenticationMethod = nil
        tokenExpiresAt = nil
        currentToken = nil
        client = nil
        configurationError = message
    }

    private func resolveOrganizationContext(
        using bootstrapClient: APIClient,
        token: String
    ) async throws -> ResolvedOrganizationContext {
        let organizationResponse: OrganizationListResponse
        do {
            organizationResponse = try await bootstrapClient.organizations()
        } catch let error as APIClientError where error.statusCode == 404 {
            // Keep the current app usable with pre-organization Inventory servers.
            let capabilities = try await bootstrapClient.capabilities()
            return ResolvedOrganizationContext(
                organizations: [],
                activeOrganization: nil,
                capabilities: capabilities,
                client: bootstrapClient,
                principalIdentifier: principalIdentifier(
                    from: capabilities,
                    token: token
                )
            )
        }

        let listedOrganizations = normalizedOrganizations(organizationResponse.organizations)
        guard !listedOrganizations.isEmpty else {
            throw APIClientError.invalidRequest(
                "Diesem Konto ist noch keine Organisation zugeordnet."
            )
        }
        let preferredID = storedOrganizationID(for: bootstrapClient.serverURL)
        let selectedOrganization = preferredID.flatMap { identifier in
            listedOrganizations.first(where: { $0.id == identifier })
        } ?? organizationResponse.activeOrganizationId.flatMap { identifier in
            listedOrganizations.first(where: { $0.id == identifier })
        } ?? listedOrganizations[0]

        let selection = try await bootstrapClient.selectOrganization(
            id: selectedOrganization.id
        )
        guard selection.organization.id == selectedOrganization.id else {
            throw APIClientError.invalidResponse
        }
        let scopedClient = try makeClient(
            serverURL: bootstrapClient.serverURL,
            token: token,
            organizationID: selection.organization.id
        )
        let capabilities = try await scopedClient.capabilities()
        if let reportedOrganization = capabilities.activeOrganization,
           reportedOrganization.id != selection.organization.id {
            throw APIClientError.invalidResponse
        }
        let reportedOrganizations = normalizedOrganizations(
            capabilities.organizations ?? listedOrganizations
        )
        guard reportedOrganizations.contains(where: { $0.id == selectedOrganization.id }) else {
            throw APIClientError.invalidResponse
        }
        let activeOrganization = capabilities.activeOrganization
            ?? reportedOrganizations.first(where: { $0.id == selectedOrganization.id })
            ?? selection.organization
        return ResolvedOrganizationContext(
            organizations: reportedOrganizations,
            activeOrganization: activeOrganization,
            capabilities: capabilities,
            client: scopedClient,
            principalIdentifier: principalIdentifier(
                from: capabilities,
                token: token
            )
        )
    }

    private func normalizedOrganizations(
        _ candidates: [InventoryOrganization]
    ) -> [InventoryOrganization] {
        var seen = Set<UUID>()
        return candidates.filter { organization in
            !organization.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && seen.insert(organization.id).inserted
        }
    }

    private func allows(_ permission: String, legacyScope: String) -> Bool {
        hasGranularPermissions
            ? grantedPermissions.contains(permission)
            : grantedScopes.contains(legacyScope)
    }

    private func canProcessIntakeQueue(
        scopes: Set<String>,
        permissions: Set<String>,
        hasGranularPermissions: Bool
    ) -> Bool {
        if hasGranularPermissions {
            return permissions.contains("inventory.create") &&
                permissions.contains("inventory.update")
        }
        return scopes.contains("write")
    }

    private func storedOrganizationID(for serverURL: URL) -> UUID? {
        let stored = defaults.dictionary(forKey: organizationPreferencesKey)?[
            serverURL.absoluteString
        ] as? String
        return stored.flatMap(UUID.init(uuidString:))
    }

    private func rememberActiveOrganization(
        _ organization: InventoryOrganization?,
        for serverURL: URL
    ) {
        guard let organization else { return }
        var preferences = defaults.dictionary(forKey: organizationPreferencesKey)?
            .compactMapValues { $0 as? String } ?? [:]
        preferences[serverURL.absoluteString] = organization.id.uuidString.lowercased()
        defaults.set(preferences, forKey: organizationPreferencesKey)
    }

    private func scheduleImageModelDiscovery(
        using discoveryClient: APIClient,
        activeClient: APIClient,
        scopes: Set<String>
    ) {
        guard scopes.contains("ai") else {
            resetImageModelState()
            return
        }
        availableImageModels = []
        defaultImageModelID = nil
        aiCostEstimates = [:]
        selectedImageModelID = storedImageModelID(for: activeClient)
        loadPromptPreferences(for: activeClient)
        Task { [weak self] in
            await self?.loadImageModels(
                using: discoveryClient,
                activeClient: activeClient
            )
        }
    }

    private func loadImageModels(
        using discoveryClient: APIClient,
        activeClient: APIClient
    ) async {
        do {
            let response = try await discoveryClient.imageGenerationModels()
            guard client === activeClient else { return }

            var seen = Set<String>()
            let models = response.models.filter { option in
                !option.id.isEmpty && seen.insert(option.id).inserted
            }
            availableImageModels = models
            aiCostEstimates = response.costEstimates?.operations ?? [:]
            defaultImageModelID = response.defaultModelId.flatMap { identifier in
                models.contains(where: { $0.id == identifier }) ? identifier : nil
            }

            let storedSelection = storedImageModelID(for: activeClient)
            if let storedSelection,
               models.contains(where: { $0.id == storedSelection }) {
                selectedImageModelID = storedSelection
            } else {
                selectedImageModelID = nil
                if storedSelection != nil {
                    selectImageModel(nil)
                }
            }
        } catch {
            guard client === activeClient else { return }
            // Model discovery is optional. Older or temporarily unavailable servers
            // keep using a remembered explicit selection when one exists.
            availableImageModels = []
            defaultImageModelID = nil
            aiCostEstimates = [:]
        }
    }

    private func storedImageModelID(for client: APIClient) -> String? {
        let preferences = defaults.dictionary(forKey: imageModelPreferencesKey)
        return preferences?[client.contextIdentifier] as? String
            ?? preferences?[client.serverURL.absoluteString] as? String
    }

    private func loadPromptPreferences(for client: APIClient) {
        analysisPrompt = AIPromptPreferences.analysisPrompt(
            for: client.contextIdentifier,
            in: defaults
        )
        coverPrompt = AIPromptPreferences.coverPrompt(
            for: client.contextIdentifier,
            in: defaults
        )
        transparentCoverPrompt = AIPromptPreferences.transparentCoverPrompt(
            for: client.contextIdentifier,
            in: defaults
        )
    }

    private func resetImageModelState() {
        availableImageModels = []
        defaultImageModelID = nil
        selectedImageModelID = nil
        aiCostEstimates = [:]
        analysisPrompt = nil
        coverPrompt = nil
        transparentCoverPrompt = nil
    }

    private func revokeBestEffort(serverURL: URL, token: String) async {
        guard let revokeClient = try? makeClient(serverURL: serverURL, token: token) else { return }
        try? await revokeClient.logout()
    }

    private var credentialSnapshot: CredentialSnapshot? {
        guard let currentToken,
              let authenticationMethod,
              let serverURL = URL(string: serverAddress) else { return nil }
        return CredentialSnapshot(
            token: currentToken,
            method: authenticationMethod,
            serverURL: serverURL
        )
    }

    private func isCredentialSwitch(
        from previous: CredentialSnapshot,
        toServerURL: URL,
        token: String
    ) -> Bool {
        previous.token != token || !sameOrigin(previous.serverURL, toServerURL)
    }

    @discardableResult
    private func beginAuthenticationOperation() -> UUID {
        let identifier = UUID()
        authenticationOperationID = identifier
        return identifier
    }

    private func ensureCurrent(_ operationID: UUID) throws {
        guard authenticationOperationID == operationID else { throw CancellationError() }
    }

    private var isLoginExpired: Bool {
        guard let tokenExpiresAt else { return true }
        return tokenExpiresAt <= Date()
    }

    private func serverURL(from value: String) throws -> URL {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, let url = URL(string: normalized) else {
            throw APIClientError.invalidServerURL
        }
        return url
    }

    private func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased() &&
            lhs.host?.lowercased() == rhs.host?.lowercased() &&
            effectivePort(of: lhs) == effectivePort(of: rhs)
    }

    private func effectivePort(of url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }

    private func makeClient(
        serverURL: URL,
        token: String?,
        organizationID: UUID? = nil,
        principalIdentifier: String? = nil,
        onUnauthorized: (@Sendable () async -> Void)? = nil
    ) throws -> APIClient {
        try APIClient(
            serverURL: serverURL,
            credentialStore: InMemoryCredentialStore(token: token),
            organizationID: organizationID,
            principalIdentifier: principalIdentifier,
            onUnauthorized: onUnauthorized
        )
    }

    private func makeActiveClient(
        serverURL: URL,
        token: String,
        organizationID: UUID?,
        principalIdentifier: String
    ) throws -> (client: APIClient, identifier: UUID) {
        let identifier = UUID()
        let client = try makeClient(
            serverURL: serverURL,
            token: token,
            organizationID: organizationID,
            principalIdentifier: principalIdentifier,
            onUnauthorized: { [weak self] in
                await self?.handleUnauthorized(clientID: identifier, token: token)
            }
        )
        return (client, identifier)
    }

    private func principalIdentifier(
        from capabilities: CapabilitiesResponse,
        token: String
    ) -> String {
        let reported = capabilities.principal?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let reported, !reported.isEmpty { return reported }

        // Pre-principal servers cannot identify a user independently of their
        // credential. A one-way token fingerprint still prevents another local
        // account from inheriting its durable upload jobs.
        let digest = SHA256.hash(data: Data(token.utf8))
        return "legacy-token:" + digest.map { String(format: "%02x", $0) }.joined()
    }
}

private struct ResolvedOrganizationContext {
    let organizations: [InventoryOrganization]
    let activeOrganization: InventoryOrganization?
    let capabilities: CapabilitiesResponse
    let client: APIClient
    let principalIdentifier: String
}

private struct CredentialSnapshot {
    let token: String
    let method: StoredAuthenticationMethod
    let serverURL: URL
}

private enum StoredAuthenticationMethod: String {
    case login
    case apiToken
}

enum RootTab: Hashable {
    case inventory
    case map
    case rooms
    case settings
    case search
}

enum PresentedTool: String, Identifiable {
    case capture
    case scanner

    var id: String { rawValue }
}

import CryptoKit
import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published private(set) var isRestoringSession = true
    @Published private(set) var isChangingConnection = false
    @Published private(set) var savedAccounts: [SavedAccount] = []
    @Published private(set) var activeAccountID: UUID?
    @Published private(set) var restorationFailed = false
    @Published private var isClearingCredential = false
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
    @Published private(set) var inventoryAISettings: InventoryAISettingsResponse?
    @Published private(set) var coverPrompt: String?
    @Published private(set) var transparentCoverPrompt: String?
    @Published var selectedTab: RootTab = .inventory
    @Published var presentedTool: PresentedTool?
    @Published var pendingScanCode: String?
    @Published var pendingInventoryLink: InventoryLink?
    @Published var pendingCaptureCode: String?

    let intakeQueue = IntakeQueue()

    private let credentialStore: any CredentialStore
    private let accountStore: any CredentialStore
    private let session: URLSession?
    private var accountVault = SavedAccountVault()
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
    @Published private(set) var isVerifyingStoredCredential = false
    private var hasGranularPermissions = false

    init(
        credentialStore: any CredentialStore = KeychainCredentialStore(),
        defaults: UserDefaults = .standard,
        accountStore: any CredentialStore = KeychainCredentialStore(account: "inventory-saved-accounts-v1"),
        session: URLSession? = nil
    ) {
        self.credentialStore = credentialStore
        self.accountStore = accountStore
        self.session = session
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

    var isConnecting: Bool {
        isRestoringSession || isVerifyingStoredCredential || isChangingConnection || isClearingCredential
    }

    var isConfigured: Bool { client != nil && hasStoredToken }
    var canReadInventory: Bool { allows("inventory.read", legacyScope: "read") }
    var canCreateInventory: Bool { allows("inventory.create", legacyScope: "write") }
    var canUpdateInventory: Bool { allows("inventory.update", legacyScope: "write") }
    var canDeleteInventory: Bool { allows("inventory.delete", legacyScope: "write") }
    var canReadStock: Bool { allows("stock.read", legacyScope: "read") }
    var canManageStock: Bool { allows("stock.manage", legacyScope: "write") }
    var canReadWorkflows: Bool { allows("workflows.read", legacyScope: "read") }
    var canManageWorkflows: Bool { allows("workflows.manage", legacyScope: "write") }
    var canReadAssignments: Bool { allows("assignments.read", legacyScope: "read") }
    var canManageAssignments: Bool { allows("assignments.manage", legacyScope: "write") }
    var canReadRequests: Bool { allows("requests.read", legacyScope: "read") }
    var canCreateRequests: Bool { allows("requests.create", legacyScope: "write") }
    var canManageRequests: Bool { allows("requests.manage", legacyScope: "write") }
    var canReadSpatial: Bool { allows("spatial.read", legacyScope: "read") }
    var canManageSpatial: Bool { allows("spatial.manage", legacyScope: "write") }
    var canUseAI: Bool {
        hasGranularPermissions
            ? grantedPermissions.contains { $0.hasPrefix("ai.") }
            : grantedScopes.contains("ai")
    }
    var canAnalyzeInventory: Bool { allows("ai.analyze", legacyScope: "ai") }
    var canManageAISettings: Bool { allows("roles.manage", legacyScope: "admin") }
    var canResearchInventory: Bool { allows("ai.research", legacyScope: "ai") }
    var canGenerateInventoryImages: Bool { allows("ai.images", legacyScope: "ai") }
    var canTranslateInventory: Bool { allows("ai.translate", legacyScope: "ai") }
    var canCaptureInventory: Bool { canCreateInventory && canUpdateInventory }
    var canWrite: Bool {
        canCreateInventory || canUpdateInventory || canDeleteInventory ||
            canManageStock || canManageAssignments || canCreateRequests ||
            canManageRequests || canManageSpatial
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
        try beginConnectionChange()
        defer { isChangingConnection = false }
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
        } else if let storedToken = currentToken,
                  !storedToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try ensureCurrent(operationID)
            guard let storedURL = URL(string: serverAddress),
                  sameDeployment(normalizedURL, storedURL) else {
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
        try beginConnectionChange()
        defer { isChangingConnection = false }
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
                operationID: operationID,
                accountLabel: response.user.email,
                accountUserID: response.user.id
            )
        } catch {
            await revokeBestEffort(serverURL: url, token: token)
            throw error
        }
    }

    @discardableResult
    func loginWithBrowser(
        server: String,
        privateSession: Bool = false,
        authenticate: @MainActor (URL, Bool) async throws -> URL
    ) async throws -> ResourceListResponse {
        try beginConnectionChange()
        defer { isChangingConnection = false }
        let operationID = beginAuthenticationOperation()
        let bootstrap = try makeClient(serverURL: serverURL(from: server), token: nil)
        let attempt = try BrowserSignInAttempt()
        let start: BrowserSignInStartResponse
        do {
            start = try await bootstrap.startBrowserSignIn(challenge: attempt.challenge, state: attempt.state)
        } catch let error as APIClientError where error.statusCode == 404 {
            throw APIClientError.invalidRequest(L10n.text("ui_browser_sign_in_update_server"))
        }
        guard start.expiresAt > Date() else { throw APIClientError.invalidResponse }
        try ensureCurrent(operationID)
        let url = try attempt.authorizationURL(serverURL: bootstrap.serverURL, requestID: start.requestId)
        let callback = try await authenticate(url, privateSession)
        try ensureCurrent(operationID)
        let code = try attempt.code(from: callback)
        let response = try await bootstrap.exchangeBrowserSignIn(requestID: start.requestId, code: code, verifier: attempt.verifier)
        let token = response.token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { throw APIClientError.invalidResponse }
        do {
            guard response.expiresAt > Date() else { throw APIClientError.invalidResponse }
            try ensureCurrent(operationID)
            return try await validateAndActivate(
                serverURL: bootstrap.serverURL, token: token, method: .login,
                expiresAt: response.expiresAt, operationID: operationID,
                accountLabel: response.user.email,
                accountUserID: response.user.id
            )
        } catch {
            await revokeBestEffort(serverURL: bootstrap.serverURL, token: token)
            throw error
        }
    }

    private func validateAndActivate(
        serverURL: URL,
        token: String,
        method: StoredAuthenticationMethod,
        expiresAt: Date?,
        operationID: UUID,
        accountLabel: String? = nil,
        accountUserID: String? = nil,
        preferredOrganizationID: UUID? = nil
    ) async throws -> ResourceListResponse {
        let replacingSession = isConfigured
        let submittedClient = try makeClient(serverURL: serverURL, token: token)
        // Preserve the stored deployment spelling so adding a trailing slash or
        // an explicit default port cannot duplicate an account or its caches.
        let knownServer = savedAccounts.compactMap { URL(string: $0.serverAddress) }
            .first { sameDeployment($0, submittedClient.serverURL) }
        let bootstrapClient = try knownServer.map { try makeClient(serverURL: $0, token: token) }
            ?? submittedClient
        let organizationContext = try await resolveOrganizationContext(
            using: bootstrapClient,
            token: token,
            preferredOrganizationID: preferredOrganizationID
        )

        try ensureCurrent(operationID)
        let candidateScopes = Set(organizationContext.capabilities.scopes)
        let candidatePermissions = Set(organizationContext.capabilities.permissions ?? [])
        let candidateHasGranularPermissions = organizationContext.capabilities.permissions != nil
        guard Self.supportsInventory(scopes: candidateScopes) else {
            throw APIClientError.invalidRequest(L10n.text("ui_this_account_cannot_view_inventory_323e491b"))
        }
        let testResult = try await organizationContext.client.listResources(page: 1, pageSize: 1)
        try ensureCurrent(operationID)

        let (nextClient, nextClientID) = try makeActiveClient(
            serverURL: organizationContext.client.serverURL,
            token: token,
            organizationID: organizationContext.activeOrganization?.id,
            principalIdentifier: organizationContext.principalIdentifier
        )
        try await saveAccount(
            context: organizationContext,
            token: token,
            method: method,
            expiresAt: expiresAt,
            label: accountLabel,
            userID: accountUserID
        )
        try ensureCurrent(operationID)

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
        authenticationMethod = method
        tokenExpiresAt = expiresAt
        currentToken = token
        activeClientID = nextClientID
        client = nextClient
        selectedTab = .inventory
        presentedTool = nil
        pendingScanCode = nil
        pendingCaptureCode = nil
        if replacingSession { pendingInventoryLink = nil }
        configurationError = nil
        restorationFailed = false
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
        guard let activeAccountID else { throw APIClientError.missingCredential }
        try await switchAccount(to: activeAccountID, organizationID: organizationID)
    }

    func switchAccount(to accountID: UUID, organizationID: UUID? = nil) async throws {
        if isConfigured, accountID == activeAccountID,
           organizationID == nil || organizationID == activeOrganization?.id { return }
        try beginConnectionChange()
        defer {
            isChangingConnection = false
            isSwitchingOrganization = false
        }
        guard let account = savedAccounts.first(where: { $0.id == accountID }) else {
            throw APIClientError.missingCredential
        }
        guard !account.requiresSignIn else {
            throw APIClientError.invalidRequest(L10n.text("ui_please_sign_in_again_9429828e"))
        }
        isSwitchingOrganization = true
        let operationID = beginAuthenticationOperation()
        _ = try await validateAndActivate(
            serverURL: serverURL(from: account.serverAddress),
            token: account.token,
            method: account.method,
            expiresAt: account.expiresAt,
            operationID: operationID,
            accountLabel: account.label,
            accountUserID: account.userID,
            preferredOrganizationID: organizationID
        )
    }

    private func beginConnectionChange() throws {
        guard !isConnecting, !restorationFailed else { throw CancellationError() }
        isChangingConnection = true
    }

    func disconnect() async throws {
        try beginConnectionChange()
        defer { isChangingConnection = false }
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
                let error = APIClientError.transport(L10n.text("ui_unable_to_sign_out_at_the_moment_c899142d"))
                configurationError = error.localizedDescription
                throw error
            }
            do {
                try await currentClient.logout()
            } catch let error as APIClientError where error.statusCode == 401 {
                // The server has already invalidated this device credential.
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
        }

        await clearLocalCredential(
            matching: token,
            message: nil,
            expectedOperationID: operationID
        )
        if let configurationError { throw APIClientError.transport(configurationError) }
    }

    func resumeUploads() {
        guard !isConnecting, !restorationFailed else { return }
        if authenticationMethod == .login, isLoginExpired {
            intakeQueue.configure(client: nil)
            if let currentToken {
                let operationID = authenticationOperationID
                Task {
                    await clearLocalCredential(
                        matching: currentToken,
                        message: L10n.text("ui_please_sign_in_again_9429828e"),
                        expectedOperationID: operationID
                    )
                }
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

    func retryRestoration() async {
        guard !isConnecting else { return }
        await restoreConfiguration()
    }

    private func restoreConfiguration() async {
        isRestoringSession = true
        restorationFailed = false
        defer { isRestoringSession = false }
        let operationID = beginAuthenticationOperation()
        intakeQueue.configure(client: nil)
        do {
            if let stored = try await accountStore.loadBearerToken() {
                accountVault = try JSONDecoder().decode(SavedAccountVault.self, from: Data(stored.utf8))
            } else if let token = try await credentialStore.loadBearerToken(),
                      !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      let url = URL(string: serverAddress), !serverAddress.isEmpty {
                // Migrate the existing installation before making any network request.
                let canonicalURL = try makeClient(serverURL: url, token: nil).serverURL
                let account = SavedAccount(
                    id: UUID(), serverAddress: canonicalURL.absoluteString,
                    principalIdentifier: "", label: canonicalURL.host ?? serverAddress,
                    token: token, method: authenticationMethod ?? .apiToken,
                    expiresAt: tokenExpiresAt, organizations: [],
                    activeOrganizationID: storedOrganizationID(for: canonicalURL)
                )
                try await persistVault(SavedAccountVault(accounts: [account], activeAccountID: account.id))
                _ = try await credentialStore.deleteBearerToken(matching: token)
            }
            try ensureCurrent(operationID)
            publishAccounts()
            guard let account = accountVault.activeAccount else { return }
            serverAddress = account.serverAddress
            authenticationMethod = account.method
            tokenExpiresAt = account.expiresAt
            currentToken = account.token
            hasStoredToken = true
            client = nil
            grantedScopes = []
            grantedPermissions = []
            hasGranularPermissions = false
            if account.requiresSignIn {
                await clearLocalCredential(
                    matching: account.token,
                    message: L10n.text("ui_please_sign_in_again_9429828e"),
                    expectedOperationID: operationID
                )
                return
            }
            await verifyStoredCredential(
                token: account.token,
                serverURL: try serverURL(from: account.serverAddress),
                operationID: operationID
            )
        } catch is CancellationError {
            return
        } catch {
            if authenticationOperationID == operationID {
                restorationFailed = true
                configurationError = error.localizedDescription
            }
        }
    }

    private func verifyStoredCredentialIfNeeded() async {
        guard !isConnecting,
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
                throw APIClientError.invalidRequest(L10n.text("ui_this_account_cannot_view_inventory_323e491b"))
            }
            let (restoredClient, restoredClientID) = try makeActiveClient(
                serverURL: organizationContext.client.serverURL,
                token: token,
                organizationID: organizationContext.activeOrganization?.id,
                principalIdentifier: organizationContext.principalIdentifier
            )
            try await saveAccount(
                context: organizationContext, token: token,
                method: authenticationMethod ?? .apiToken,
                expiresAt: tokenExpiresAt, label: nil
            )
            try ensureCurrent(operationID)
            activeClientID = restoredClientID
            client = restoredClient
            hasStoredToken = true
            grantedScopes = scopes
            grantedPermissions = permissions
            hasGranularPermissions = receivedGranularPermissions
            organizations = organizationContext.organizations
            activeOrganization = organizationContext.activeOrganization
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
                message: L10n.text("ui_please_sign_in_again_9429828e"),
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
        guard !isConnecting,
              activeClientID == clientID, currentToken == token else { return }
        await clearLocalCredential(
            matching: token,
            message: L10n.text("ui_please_sign_in_again_9429828e"),
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
        guard !isClearingCredential, currentToken == token else { return }
        isClearingCredential = true
        defer { isClearingCredential = false }

        let operationID = authenticationOperationID
        let accountID = activeAccountID
        do {
            var nextVault = accountVault
            nextVault.accounts.removeAll { $0.id == accountID && $0.token == token }
            nextVault.activeAccountID = nil
            try await persistVault(nextVault)
            guard authenticationOperationID == operationID, currentToken == token else { return }
            authenticationOperationID = UUID()
            activeClientID = UUID()
            clearCredentialState(message: message)
        } catch {
            // Do not keep displaying authenticated content after a known 401,
            // even if Keychain is temporarily unavailable. Retain it for retry.
            if authenticationOperationID == operationID {
                client = nil
                grantedScopes = []
                grantedPermissions = []
                hasGranularPermissions = false
                intakeQueue.configure(client: nil)
                configurationError = error.localizedDescription
            }
        }
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
        selectedTab = .inventory
        presentedTool = nil
        pendingScanCode = nil
        pendingCaptureCode = nil
        pendingInventoryLink = nil
        configurationError = message
    }

    private func resolveOrganizationContext(
        using bootstrapClient: APIClient,
        token: String,
        preferredOrganizationID: UUID? = nil
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
                L10n.text("ui_no_organization_has_been_assigned_to_this_5bad720b")
            )
        }
        let preferredID = preferredOrganizationID ?? savedAccounts.first {
            $0.serverAddress == bootstrapClient.serverURL.absoluteString && $0.token == token
        }?.activeOrganizationID
        if let preferredOrganizationID,
           !listedOrganizations.contains(where: { $0.id == preferredOrganizationID }) {
            throw APIClientError.invalidRequest(L10n.text("ui_the_organization_is_unavailable_10c19dda"))
        }
        let selectedOrganization = preferredID.flatMap { identifier in
            listedOrganizations.first(where: { $0.id == identifier })
        } ?? organizationResponse.activeOrganizationId.flatMap { identifier in
            listedOrganizations.first(where: { $0.id == identifier })
        } ?? listedOrganizations[0]

        let selection: OrganizationSelectionResponse
        if token == "inv_demo_public_openinventory" {
            guard listedOrganizations.count == 1,
                  selectedOrganization.id.uuidString.lowercased() == "d3e00000-0000-4000-8000-000000000001",
                  selectedOrganization.isReadOnly == true,
                  selectedOrganization.role == "viewer" else {
                throw APIClientError.invalidRequest(L10n.text("ui_the_demo_is_not_configured_as_a_10faaf4a"))
            }
            selection = OrganizationSelectionResponse(organization: selectedOrganization)
        } else {
            selection = try await bootstrapClient.selectOrganization(id: selectedOrganization.id)
        }
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
        inventoryAISettings = nil
        loadPromptPreferences(for: activeClient)
        Task { [weak self] in
            await self?.loadImageModels(
                using: discoveryClient,
                activeClient: activeClient
            )
        }
    }

    func refreshInventoryAISettings() async throws -> InventoryAISettingsResponse {
        guard let activeClient = client else { throw URLError(.userAuthenticationRequired) }
        let result = try await activeClient.inventoryAISettings()
        guard client === activeClient else { throw CancellationError() }
        inventoryAISettings = result
        if let data = try? JSONEncoder().encode(result) {
            var cached = defaults.dictionary(forKey: "inventory.ai.sharedSettings") ?? [:]
            cached[activeClient.contextIdentifier] = data
            defaults.set(cached, forKey: "inventory.ai.sharedSettings")
        }
        if let estimates = result.costEstimates {
            for key in ["inventoryAnalysis", "inventoryResearch"] {
                aiCostEstimates[key] = estimates[key]
            }
        }
        return result
    }

    func saveInventoryAISettings(_ settings: InventoryAISettingsResponse) async throws -> InventoryAISettingsResponse {
        guard let activeClient = client else { throw URLError(.userAuthenticationRequired) }
        let result = try await activeClient.saveInventoryAISettings(settings)
        guard client === activeClient else { throw CancellationError() }
        inventoryAISettings = result
        if let data = try? JSONEncoder().encode(result) {
            var cached = defaults.dictionary(forKey: "inventory.ai.sharedSettings") ?? [:]
            cached[activeClient.contextIdentifier] = data
            defaults.set(cached, forKey: "inventory.ai.sharedSettings")
        }
        if let estimates = result.costEstimates {
            for key in ["inventoryAnalysis", "inventoryResearch"] {
                aiCostEstimates[key] = estimates[key]
            }
        }
        return result
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
        if let data = defaults.dictionary(forKey: "inventory.ai.sharedSettings")?[client.contextIdentifier] as? Data {
            inventoryAISettings = try? JSONDecoder().decode(InventoryAISettingsResponse.self, from: data)
        }

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
        inventoryAISettings = nil
        coverPrompt = nil
        transparentCoverPrompt = nil
    }

    private func revokeBestEffort(serverURL: URL, token: String) async {
        guard let revokeClient = try? makeClient(serverURL: serverURL, token: token) else { return }
        try? await revokeClient.logout()
    }

    private func publishAccounts() {
        savedAccounts = accountVault.accounts
        activeAccountID = accountVault.activeAccountID
    }

    private func persistVault(_ vault: SavedAccountVault) async throws {
        let encoded = try JSONEncoder().encode(vault)
        try await accountStore.saveBearerToken(String(decoding: encoded, as: UTF8.self))
        accountVault = vault
        publishAccounts()
    }

    private func saveAccount(
        context: ResolvedOrganizationContext,
        token: String,
        method: StoredAuthenticationMethod,
        expiresAt: Date?,
        label: String?,
        userID: String? = nil
    ) async throws {
        let server = context.client.serverURL.absoluteString
        let existing = accountVault.accounts.first {
            $0.serverAddress == server &&
                ($0.token == token || $0.principalIdentifier == context.principalIdentifier ||
                 (userID != nil && $0.userID == userID))
        }
        let account = SavedAccount(
            id: existing?.id ?? UUID(), serverAddress: server,
            principalIdentifier: context.principalIdentifier,
            label: label ?? existing?.label ?? L10n.text("ui_api_token_5efaaeee"),
            token: token, method: method, expiresAt: expiresAt,
            organizations: context.organizations,
            activeOrganizationID: context.activeOrganization?.id,
            userID: userID ?? existing?.userID
        )
        var next = accountVault
        if let index = next.accounts.firstIndex(where: { $0.id == account.id }) {
            next.accounts[index] = account
        } else {
            next.accounts.append(account)
        }
        next.activeAccountID = account.id
        try await persistVault(next)
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

    private func sameDeployment(_ lhs: URL, _ rhs: URL) -> Bool {
        sameOrigin(lhs, rhs) &&
            lhs.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ==
            rhs.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
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
            session: session,
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

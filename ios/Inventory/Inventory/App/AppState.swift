import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published private(set) var serverAddress: String
    @Published private(set) var hasStoredToken = false
    @Published private(set) var client: APIClient?
    @Published private(set) var configurationError: String?
    @Published private(set) var grantedScopes: Set<String> = []
    @Published var selectedTab: RootTab = .capture
    @Published var pendingScanCode: String?
    @Published var pendingCaptureCode: String?

    let intakeQueue = IntakeQueue()

    private let credentialStore: any CredentialStore
    private let defaults: UserDefaults
    private let serverKey = "inventory.serverURL"
    private let scopesKey = "inventory.tokenScopes"
    private let authenticationMethodKey = "inventory.authenticationMethod"
    private let tokenExpiresAtKey = "inventory.tokenExpiresAt"
    private var authenticationMethod: StoredAuthenticationMethod?
    private var tokenExpiresAt: Date?
    private var currentToken: String?
    private var activeClientID = UUID()
    private var authenticationOperationID = UUID()
    private var isVerifyingStoredCredential = false

    init(
        credentialStore: any CredentialStore = KeychainCredentialStore(),
        defaults: UserDefaults = .standard
    ) {
        self.credentialStore = credentialStore
        self.defaults = defaults
        self.serverAddress = defaults.string(forKey: serverKey) ?? ""
        self.authenticationMethod = defaults.string(forKey: authenticationMethodKey)
            .flatMap(StoredAuthenticationMethod.init(rawValue:))
        self.tokenExpiresAt = defaults.object(forKey: tokenExpiresAtKey) as? Date
        Task { await restoreConfiguration() }
    }

    var isConfigured: Bool { client != nil && hasStoredToken }
    var canUseAI: Bool { grantedScopes.contains("ai") }

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
        let candidateClient = try makeClient(serverURL: serverURL, token: token)

        let capabilities = try await candidateClient.capabilities()
        try ensureCurrent(operationID)
        let candidateScopes = Set(capabilities.scopes)
        guard candidateScopes.contains("read"), candidateScopes.contains("write") else {
            throw APIClientError.invalidRequest("Dieses Konto darf Inventar nicht bearbeiten.")
        }
        let testResult = try await candidateClient.listResources(page: 1, pageSize: 1)
        try ensureCurrent(operationID)

        var previousLoginWasRevoked = false
        if let previousCredential,
           previousCredential.method == .login,
           isCredentialSwitch(
               from: previousCredential,
               toServerURL: candidateClient.serverURL,
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
            serverURL: candidateClient.serverURL,
            token: token
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
        authenticationMethod = method
        tokenExpiresAt = expiresAt
        currentToken = token
        activeClientID = nextClientID
        client = nextClient
        configurationError = nil
        intakeQueue.configure(client: nextClient)
        return testResult
    }

    func testConnection() async throws -> ResourceListResponse {
        guard let client else { throw APIClientError.missingCredential }
        return try await client.listResources(page: 1, pageSize: 1)
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
                    intakeQueue.configure(client: currentClient)
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
                intakeQueue.configure(client: currentClient)
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
            intakeQueue.configure(client: client)
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
            let candidateClient = try makeClient(serverURL: serverURL, token: token)
            let response = try await candidateClient.capabilities()
            try ensureCurrent(operationID)
            guard currentToken == token else { throw CancellationError() }
            let scopes = Set(response.scopes)
            guard scopes.contains("read"), scopes.contains("write") else {
                throw APIClientError.invalidRequest("Dieses Konto darf Inventar nicht bearbeiten.")
            }
            let (restoredClient, restoredClientID) = try makeActiveClient(
                serverURL: candidateClient.serverURL,
                token: token
            )
            activeClientID = restoredClientID
            client = restoredClient
            hasStoredToken = true
            grantedScopes = scopes
            defaults.set(Array(scopes).sorted(), forKey: scopesKey)
            configurationError = nil
            intakeQueue.configure(client: restoredClient)
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
        authenticationMethod = nil
        tokenExpiresAt = nil
        currentToken = nil
        client = nil
        configurationError = message
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
        onUnauthorized: (@Sendable () async -> Void)? = nil
    ) throws -> APIClient {
        try APIClient(
            serverURL: serverURL,
            credentialStore: InMemoryCredentialStore(token: token),
            onUnauthorized: onUnauthorized
        )
    }

    private func makeActiveClient(
        serverURL: URL,
        token: String
    ) throws -> (client: APIClient, identifier: UUID) {
        let identifier = UUID()
        let client = try makeClient(
            serverURL: serverURL,
            token: token,
            onUnauthorized: { [weak self] in
                await self?.handleUnauthorized(clientID: identifier, token: token)
            }
        )
        return (client, identifier)
    }
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
    case capture
    case scanner
    case inventory
    case uploads
    case settings
}

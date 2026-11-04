import Foundation
import XCTest
@testable import Inventory

@MainActor
final class AccountSessionTests: XCTestCase {
    private func makeState(
        vault: any CredentialStore = InMemoryCredentialStore(),
        legacy: any CredentialStore = InMemoryCredentialStore(),
        defaults: UserDefaults? = nil
    ) -> AppState {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AccountSessionURLProtocol.self]
        let preferences = defaults ?? UserDefaults(suiteName: "AccountSessionTests.\(UUID())")!
        return AppState(
            credentialStore: legacy, defaults: preferences,
            accountStore: vault, session: URLSession(configuration: configuration)
        )
    }

    private func restored(_ state: AppState) async throws {
        for _ in 0..<500 {
            if !state.isRestoringSession { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Session restoration did not finish")
    }

    func testStartsInLoadingStateBeforeReadingCredentials() async throws {
        let state = makeState()
        XCTAssertTrue(state.isRestoringSession)
        XCTAssertFalse(state.isConfigured)
        try await restored(state)
        XCTAssertFalse(state.isRestoringSession)
        XCTAssertFalse(state.hasStoredToken)
    }

    func testMigratesLegacyCredentialAndRestoresWithoutLogin() async throws {
        let defaults = UserDefaults(suiteName: "migration.\(UUID())")!
        defaults.set("https://legacy.example", forKey: "inventory.serverURL")
        let legacy = InMemoryCredentialStore(token: "legacy-token")
        let vault = InMemoryCredentialStore()
        let state = makeState(vault: vault, legacy: legacy, defaults: defaults)
        try await restored(state)
        XCTAssertTrue(state.isConfigured)
        XCTAssertEqual(state.savedAccounts.count, 1)
        let oldToken = try await legacy.loadBearerToken()
        XCTAssertNil(oldToken)
        let relaunched = makeState(vault: vault)
        try await restored(relaunched)
        XCTAssertTrue(relaunched.isConfigured)
        XCTAssertEqual(relaunched.activeAccountID, state.activeAccountID)
        XCTAssertEqual(relaunched.client?.contextIdentifier, state.client?.contextIdentifier)
    }

    func testAccountsOnDifferentDomainsKeepIndependentCredentialsAndSelection() async throws {
        let vault = InMemoryCredentialStore()
        let state = makeState(vault: vault)
        try await restored(state)
        try await state.saveConfiguration(server: "https://alpha.example", token: "alpha-token")
        let firstID = try XCTUnwrap(state.activeAccountID)
        try await state.switchOrganization(to: AccountSessionURLProtocol.secondOrganizationID)
        let firstContext = state.organizationContextIdentifier
        try await state.saveConfiguration(server: "https://beta.example", token: "beta-token")
        XCTAssertEqual(state.savedAccounts.count, 2)
        XCTAssertNotEqual(state.organizationContextIdentifier, firstContext)
        try await state.switchAccount(to: firstID)
        XCTAssertEqual(state.client?.serverURL.host, "alpha.example")
        XCTAssertEqual(state.activeOrganization?.id, AccountSessionURLProtocol.secondOrganizationID)
        XCTAssertEqual(state.organizationContextIdentifier, firstContext)
        let relaunched = makeState(vault: vault)
        try await restored(relaunched)
        XCTAssertEqual(relaunched.activeAccountID, firstID)
        XCTAssertEqual(relaunched.activeOrganization?.id, AccountSessionURLProtocol.secondOrganizationID)
        let requests = AccountSessionURLProtocol.requests(for: "alpha-token")
        XCTAssertFalse(requests.isEmpty)
        XCTAssertTrue(requests.allSatisfy { $0.url?.host == "alpha.example" })
    }

    func testTwoAccountsOnOneDomainKeepSeparateOrganizationPreferences() async throws {
        let state = makeState()
        try await restored(state)
        try await state.saveConfiguration(server: "https://shared.example", token: "alice")
        let alice = try XCTUnwrap(state.activeAccountID)
        try await state.switchOrganization(to: AccountSessionURLProtocol.secondOrganizationID)
        let aliceContext = state.organizationContextIdentifier
        try await state.saveConfiguration(server: "https://shared.example", token: "bob")
        XCTAssertEqual(state.savedAccounts.count, 2)
        XCTAssertEqual(state.activeOrganization?.id, AccountSessionURLProtocol.firstOrganizationID)
        XCTAssertNotEqual(state.organizationContextIdentifier, aliceContext)
        try await state.switchAccount(to: alice)
        XCTAssertEqual(state.activeOrganization?.id, AccountSessionURLProtocol.secondOrganizationID)
    }

    func testAddingAnotherLoginDoesNotRevokePreviousLogin() async throws {
        let state = makeState()
        try await restored(state)
        let email = "login-\(UUID())@example.com"
        try await state.login(server: "https://first.example", email: email, password: "test")
        let first = try XCTUnwrap(state.activeAccountID)
        try await state.login(server: "https://second.example", email: "second@example.com", password: "test")
        XCTAssertEqual(state.savedAccounts.count, 2)
        XCTAssertFalse(AccountSessionURLProtocol.requests(for: email).contains { $0.url?.path.hasSuffix("logout") == true })
        try await state.switchAccount(to: first)
        XCTAssertEqual(state.client?.serverURL.host, "first.example")
        try await state.disconnect()
        XCTAssertEqual(state.savedAccounts.count, 1)
        XCTAssertEqual(state.savedAccounts.first?.serverAddress, "https://second.example")
        XCTAssertFalse(state.isConfigured)
        XCTAssertTrue(AccountSessionURLProtocol.requests(for: email).contains { $0.url?.path.hasSuffix("logout") == true })
    }

    func testFailedConnectionDoesNotReplaceActiveAccount() async throws {
        let state = makeState()
        try await restored(state)
        try await state.saveConfiguration(server: "https://working.example", token: "working")
        let originalID = state.activeAccountID
        let originalContext = state.organizationContextIdentifier
        do {
            try await state.saveConfiguration(server: "https://offline.example", token: "offline")
            XCTFail("Expected a connection failure")
        } catch { }
        XCTAssertTrue(state.isConfigured)
        XCTAssertEqual(state.activeAccountID, originalID)
        XCTAssertEqual(state.organizationContextIdentifier, originalContext)
        XCTAssertEqual(state.savedAccounts.count, 1)
        XCTAssertFalse(state.isChangingConnection)
    }

    func testOfflineStartupKeepsCredentialForRetryAndDoesNotShowLogin() async throws {
        let account = account(server: "https://offline.example", token: "offline")
        let vault = try store(accounts: [account], active: account.id)
        let state = makeState(vault: vault)
        try await restored(state)
        XCTAssertFalse(state.isConfigured)
        XCTAssertTrue(state.hasStoredToken)
        XCTAssertNotNil(state.configurationError)
        XCTAssertEqual(state.savedAccounts.count, 1)
        await state.retryRestoration()
        XCTAssertTrue(state.hasStoredToken)
        XCTAssertFalse(state.isRestoringSession)
    }

    func testUnauthorizedStartupRemovesOnlyAffectedAccount() async throws {
        let invalid = account(server: "https://invalid.example", token: "rejected")
        let valid = account(server: "https://valid.example", token: "valid")
        let vault = try store(accounts: [invalid, valid], active: invalid.id)
        let state = makeState(vault: vault)
        try await restored(state)
        XCTAssertFalse(state.hasStoredToken)
        XCTAssertEqual(state.savedAccounts.map(\.id), [valid.id])
        try await state.switchAccount(to: valid.id)
        XCTAssertTrue(state.isConfigured)
    }

    func testExpiredLoginDoesNotRemoveOtherAccounts() async throws {
        let expired = account(server: "https://expired.example", token: "expired", method: .login, expiresAt: .distantPast)
        let valid = account(server: "https://valid.example", token: "valid")
        let state = makeState(vault: try store(accounts: [expired, valid], active: expired.id))
        try await restored(state)
        XCTAssertFalse(state.isConfigured)
        XCTAssertFalse(state.hasStoredToken)
        XCTAssertEqual(state.savedAccounts.map(\.id), [valid.id])
    }

    func testCorruptVaultShowsRecoveryAndCannotBeOverwrittenByLogin() async throws {
        let vault = InMemoryCredentialStore(token: "not valid JSON")
        let state = makeState(vault: vault)
        try await restored(state)
        XCTAssertTrue(state.restorationFailed)
        do {
            try await state.saveConfiguration(server: "https://new.example", token: "new")
            XCTFail("Must not overwrite an unreadable vault")
        } catch { }
        let data = try await vault.loadBearerToken()
        XCTAssertEqual(data, "not valid JSON")
    }

    func testFailedKeychainWritePreservesPreviousAccount() async throws {
        let vault = FailableAccountStore()
        let state = makeState(vault: vault)
        try await restored(state)
        try await state.saveConfiguration(server: "https://working.example", token: "first")
        let originalID = state.activeAccountID
        await vault.failWrites()
        do {
            try await state.saveConfiguration(server: "https://new.example", token: "second")
            XCTFail("Expected Keychain failure")
        } catch { }
        XCTAssertEqual(state.activeAccountID, originalID)
        XCTAssertEqual(state.savedAccounts.count, 1)
        XCTAssertTrue(state.isConfigured)
    }

    func testLogoutRemainsLoggedOutAfterRelaunchWithOtherSavedAccounts() async throws {
        let vault = InMemoryCredentialStore()
        let state = makeState(vault: vault)
        try await restored(state)
        try await state.saveConfiguration(server: "https://one.example", token: "one")
        try await state.saveConfiguration(server: "https://two.example", token: "two")
        try await state.disconnect()
        let relaunched = makeState(vault: vault)
        try await restored(relaunched)
        XCTAssertFalse(relaunched.isConfigured)
        XCTAssertNil(relaunched.activeAccountID)
        XCTAssertEqual(relaunched.savedAccounts.count, 1)
    }

    func testStaleUnauthorizedResponseCannotSignOutNewlySelectedAccount() async throws {
        let state = makeState()
        try await restored(state)
        let oldToken = "stale-\(UUID())"
        try await state.saveConfiguration(server: "https://old.example", token: oldToken)
        let oldClient = try XCTUnwrap(state.client)
        try await state.saveConfiguration(server: "https://new.example", token: "new-active")
        let newID = state.activeAccountID
        AccountSessionURLProtocol.reject(oldToken)
        _ = try? await oldClient.capabilities()
        XCTAssertTrue(state.isConfigured)
        XCTAssertEqual(state.activeAccountID, newID)
        XCTAssertEqual(state.savedAccounts.count, 2)
    }

    func testFailedLogoutPersistenceHidesInvalidSessionAndRetainsOtherAccounts() async throws {
        let vault = FailableAccountStore()
        let state = makeState(vault: vault)
        try await restored(state)
        try await state.saveConfiguration(server: "https://one.example", token: "one")
        try await state.login(server: "https://two.example", email: "logout@example.com", password: "test")
        await vault.failWrites()
        do {
            try await state.disconnect()
            XCTFail("Expected persistence failure")
        } catch { }
        XCTAssertFalse(state.isConfigured)
        XCTAssertTrue(state.hasStoredToken)
        XCTAssertEqual(state.savedAccounts.count, 2)
        XCTAssertNotNil(state.configurationError)
    }

    func testConcurrentConnectionChangeCannotOverwriteInFlightVaultWrite() async throws {
        let vault = DelayedAccountStore()
        let state = makeState(vault: vault)
        try await restored(state)
        let first = Task {
            try await state.saveConfiguration(server: "https://first.example", token: "first")
        }
        for _ in 0..<500 {
            if await vault.isWaiting { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let waiting = await vault.isWaiting
        XCTAssertTrue(waiting)
        do {
            try await state.saveConfiguration(server: "https://second.example", token: "second")
            XCTFail("Concurrent changes must wait for the current operation")
        } catch is CancellationError { }
        await vault.release()
        _ = try await first.value
        XCTAssertEqual(state.savedAccounts.count, 1)
        XCTAssertEqual(state.client?.serverURL.host, "first.example")
    }

    func testEquivalentServerAddressesDoNotDuplicateAnAccountOrItsContext() async throws {
        let state = makeState()
        try await restored(state)
        try await state.saveConfiguration(server: "https://canonical.example", token: "canonical")
        let originalID = state.activeAccountID
        let originalContext = state.organizationContextIdentifier
        try await state.saveConfiguration(server: "https://canonical.example:443/api/v1/", token: "canonical")
        XCTAssertEqual(state.savedAccounts.count, 1)
        XCTAssertEqual(state.activeAccountID, originalID)
        XCTAssertEqual(state.organizationContextIdentifier, originalContext)
    }

    func testStoredTokenCannotBeReusedForAnotherDeploymentPath() async throws {
        let state = makeState()
        try await restored(state)
        try await state.saveConfiguration(server: "https://deployment.example", token: "deployment")
        do {
            try await state.saveConfiguration(server: "https://deployment.example/other", token: nil)
            XCTFail("A different deployment needs its own credential")
        } catch { }
        XCTAssertTrue(state.isConfigured)
        XCTAssertEqual(state.savedAccounts.count, 1)
    }

    func testBrowserSignInUsesPKCEAndJoinsSavedAccountsWithoutForwardingOldToken() async throws {
        let vault = InMemoryCredentialStore()
        let state = makeState(vault: vault)
        try await restored(state)
        try await state.saveConfiguration(server: "https://previous.example", token: "previous-account")
        let previousID = state.activeAccountID
        var sawPrivateSession = false
        try await state.loginWithBrowser(server: "https://sso.example", privateSession: true) { url, privateSession in
            sawPrivateSession = privateSession
            XCTAssertEqual(url.host, "sso.example")
            XCTAssertEqual(url.path, "/api/v1/auth/browser/authorize")
            let start = try XCTUnwrap(AccountSessionURLProtocol.browserStart(for: "sso.example"))
            XCTAssertEqual(start["codeChallengeMethod"], "S256")
            return try XCTUnwrap(URL(string: "de.polyxo.openinventory://auth/callback?state=\(start["state"]!)&code=\(String(repeating: "c", count: 43))"))
        }
        XCTAssertTrue(sawPrivateSession)
        XCTAssertEqual(state.savedAccounts.count, 2)
        XCTAssertNotEqual(state.activeAccountID, previousID)
        XCTAssertEqual(state.savedAccounts.last?.label, "sso-member@example.test")
        XCTAssertEqual(state.savedAccounts.last?.method, .login)
        let requests = AccountSessionURLProtocol.browserRequests(for: "sso.example")
        XCTAssertEqual(requests.count, 2)
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
        let relaunched = makeState(vault: vault)
        try await restored(relaunched)
        XCTAssertTrue(relaunched.isConfigured)
        XCTAssertEqual(relaunched.activeAccountID, state.activeAccountID)
    }

    func testBrowserCancellationPreservesPreviousAccount() async throws {
        let state = makeState()
        try await restored(state)
        try await state.saveConfiguration(server: "https://previous.example", token: "previous-cancel")
        let previousID = state.activeAccountID
        do {
            try await state.loginWithBrowser(server: "https://cancel-sso.example") { _, _ in throw CancellationError() }
            XCTFail("Expected cancellation")
        } catch is CancellationError { }
        XCTAssertEqual(state.activeAccountID, previousID)
        XCTAssertTrue(state.isConfigured)
        XCTAssertFalse(state.isChangingConnection)
        XCTAssertEqual(state.savedAccounts.count, 1)
    }

    func testBrowserCallbackWithWrongStateNeverExchangesCode() async throws {
        let state = makeState()
        try await restored(state)
        do {
            try await state.loginWithBrowser(server: "https://wrong-state.example") { _, _ in
                try XCTUnwrap(URL(string: "de.polyxo.openinventory://auth/callback?state=wrong&code=\(String(repeating: "c", count: 43))"))
            }
            XCTFail("Expected state validation failure")
        } catch { }
        XCTAssertFalse(state.isConfigured)
        XCTAssertTrue(state.savedAccounts.isEmpty)
        XCTAssertEqual(AccountSessionURLProtocol.browserRequests(for: "wrong-state.example").count, 1)
    }

    func testRepeatedSSOForSameUserUpdatesExistingSavedAccount() async throws {
        let state = makeState()
        try await restored(state)
        let authenticate: @MainActor (URL, Bool) async throws -> URL = { _, _ in
            let start = try XCTUnwrap(AccountSessionURLProtocol.browserStart(for: "repeat-sso.example"))
            return try XCTUnwrap(URL(string: "de.polyxo.openinventory://auth/callback?state=\(start["state"]!)&code=\(String(repeating: "c", count: 43))"))
        }
        try await state.loginWithBrowser(server: "https://repeat-sso.example", authenticate: authenticate)
        let firstID = state.activeAccountID
        let firstToken = state.savedAccounts.first?.token
        try await state.switchOrganization(to: AccountSessionURLProtocol.secondOrganizationID)
        try await state.loginWithBrowser(server: "https://repeat-sso.example", authenticate: authenticate)
        XCTAssertEqual(state.savedAccounts.count, 1)
        XCTAssertEqual(state.activeAccountID, firstID)
        XCTAssertNotEqual(state.savedAccounts.first?.token, firstToken)
    }

    private func account(server: String, token: String, method: StoredAuthenticationMethod = .apiToken, expiresAt: Date? = nil) -> SavedAccount {
        SavedAccount(id: UUID(), serverAddress: server, principalIdentifier: "user:\(token)", label: token,
                     token: token, method: method, expiresAt: expiresAt, organizations: [], activeOrganizationID: nil)
    }

    private func store(accounts: [SavedAccount], active: UUID) throws -> InMemoryCredentialStore {
        let data = try JSONEncoder().encode(SavedAccountVault(accounts: accounts, activeAccountID: active))
        return InMemoryCredentialStore(token: String(decoding: data, as: UTF8.self))
    }
}

private actor FailableAccountStore: CredentialStore {
    private var value: String?
    private var shouldFail = false
    func failWrites() { shouldFail = true }
    func loadBearerToken() async throws -> String? { value }
    func saveBearerToken(_ token: String) async throws {
        if shouldFail { throw URLError(.cannotWriteToFile) }
        value = token
    }
    func deleteBearerToken() async throws { value = nil }
    func deleteBearerToken(matching token: String) async throws -> Bool {
        guard value == token else { return false }
        value = nil
        return true
    }
}

private actor DelayedAccountStore: CredentialStore {
    private var value: String?
    private var continuation: CheckedContinuation<Void, Never>?
    var isWaiting: Bool { continuation != nil }
    func release() { continuation?.resume(); continuation = nil }
    func loadBearerToken() async throws -> String? { value }
    func saveBearerToken(_ token: String) async throws {
        await withCheckedContinuation { continuation = $0 }
        value = token
    }
    func deleteBearerToken() async throws { value = nil }
    func deleteBearerToken(matching token: String) async throws -> Bool {
        guard value == token else { return false }
        value = nil
        return true
    }
}

private final class AccountSessionURLProtocol: URLProtocol, @unchecked Sendable {
    static let firstOrganizationID = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
    static let secondOrganizationID = UUID(uuidString: "00000000-0000-4000-8000-000000000002")!
    private static let lock = NSLock()
    nonisolated(unsafe) private static var recordedRequests: [URLRequest] = []
    nonisolated(unsafe) private static var rejectedTokens: Set<String> = ["rejected"]
    nonisolated(unsafe) private static var browserStarts: [String: [String: String]] = [:]

    static func browserStart(for host: String) -> [String: String]? {
        lock.lock()
        defer { lock.unlock() }
        return browserStarts[host]
    }

    static func browserRequests(for host: String) -> [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recordedRequests.filter { $0.url?.host == host && $0.url?.path.contains("/auth/browser/") == true }
    }


    static func reject(_ token: String) {
        lock.lock()
        defer { lock.unlock() }
        rejectedTokens.insert(token)
    }

    static func requests(for token: String) -> [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recordedRequests.filter { $0.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)" }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() { }

    override func startLoading() {
        Self.lock.lock()
        Self.recordedRequests.append(request)
        Self.lock.unlock()
        guard let url = request.url else { return }
        if url.host == "offline.example" {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let token = request.value(forHTTPHeaderField: "Authorization")?.replacingOccurrences(of: "Bearer ", with: "") ?? ""
        let orgs: [[String: Any]] = [
            ["id": Self.firstOrganizationID.uuidString, "name": "First organization", "slug": "first"],
            ["id": Self.secondOrganizationID.uuidString, "name": "Second organization", "slug": "second"]
        ]
        let body = requestBody()
        let selectedID = body["organizationId"] as? String ?? request.value(forHTTPHeaderField: "X-Organization-ID")
        let selected = orgs.first { ($0["id"] as? String)?.lowercased() == selectedID?.lowercased() } ?? orgs[0]
        Self.lock.lock()
        let status = Self.rejectedTokens.contains(token) ? 401 : 200
        Self.lock.unlock()
        let payload: [String: Any]
        if status == 401 {
            payload = ["error": "Unauthorized"]
        } else if url.path.hasSuffix("/auth/browser/start") {
            Self.lock.lock()
            Self.browserStarts[url.host!] = body as? [String: String]
            Self.lock.unlock()
            payload = ["requestId": String(repeating: "r", count: 43), "expiresAt": "2099-01-01T00:00:00.000Z"]
        } else if url.path.hasSuffix("/auth/browser/exchange") {
            let verifier = body["codeVerifier"] as? String ?? ""
            let start = Self.browserStart(for: url.host!)
            XCTAssertEqual(BrowserSignInAttempt(verifier: verifier, state: "").challenge, start?["codeChallenge"])
            XCTAssertEqual(body["requestId"] as? String, String(repeating: "r", count: 43))
            XCTAssertEqual(body["code"] as? String, String(repeating: "c", count: 43))
            payload = ["token": "sso-session-\(UUID())", "user": ["id": "sso-member", "name": "SSO member", "email": "sso-member@example.test", "role": "viewer"],
                       "scopes": ["read"], "expiresAt": "2099-01-01T00:00:00.000Z"]
        } else if url.path.hasSuffix("/auth/login") {
            let email = body["email"] as? String ?? "user@example.com"
            payload = ["token": email, "user": ["id": email, "name": email, "email": email, "role": "viewer"],
                       "scopes": ["read"], "expiresAt": "2099-01-01T00:00:00.000Z"]
        } else if url.path.hasSuffix("/organizations/select") {
            payload = ["organization": selected]
        } else if url.path.hasSuffix("/organizations") {
            payload = ["organizations": orgs, "activeOrganizationId": Self.firstOrganizationID.uuidString]
        } else if url.path.hasSuffix("/auth/capabilities") {
            payload = ["name": "Test", "principal": "user:\(token)", "scopes": ["read"], "organizations": orgs, "organization": selected]
        } else if url.path.hasSuffix("/resources") {
            payload = ["resources": [], "pagination": ["page": 1, "pageSize": 1, "total": 0, "pages": 1]]
        } else {
            payload = ["success": true]
        }
        let data = try! JSONSerialization.data(withJSONObject: payload)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private func requestBody() -> [String: Any] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                data.append(buffer, count: count)
            }
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}

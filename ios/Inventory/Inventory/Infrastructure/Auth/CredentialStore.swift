import Foundation

public protocol CredentialStore: Sendable {
    func loadBearerToken() async throws -> String?
    func saveBearerToken(_ token: String) async throws
    func deleteBearerToken() async throws
    @discardableResult
    func deleteBearerToken(matching token: String) async throws -> Bool
}

public actor InMemoryCredentialStore: CredentialStore {
    private var token: String?

    public init(token: String? = nil) {
        self.token = token
    }

    public func loadBearerToken() async throws -> String? {
        token
    }

    public func saveBearerToken(_ token: String) async throws {
        self.token = token
    }

    public func deleteBearerToken() async throws {
        token = nil
    }

    @discardableResult
    public func deleteBearerToken(matching expectedToken: String) async throws -> Bool {
        guard token == expectedToken else { return false }
        token = nil
        return true
    }
}

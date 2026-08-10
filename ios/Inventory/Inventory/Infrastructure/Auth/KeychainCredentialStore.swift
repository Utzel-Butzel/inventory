import Foundation
import Security

public enum KeychainCredentialError: Error, LocalizedError, Sendable {
    case emptyToken
    case invalidStoredValue
    case unexpectedStatus(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .emptyToken:
            return "The bearer token is empty."
        case .invalidStoredValue:
            return "The saved bearer token is not valid UTF-8."
        case .unexpectedStatus(let status):
            let message = SecCopyErrorMessageString(status, nil) as String?
            return message ?? "Keychain failed with status \(status)."
        }
    }
}

/// Stores the API credential locally on this device. `AfterFirstUnlock` also
/// permits background URLSession work after the user has unlocked once.
public actor KeychainCredentialStore: CredentialStore {
    private let service: String
    private let account: String

    public init(
        service: String = "digital.congru.Inventory",
        account: String = "inventory-api-bearer-token"
    ) {
        self.service = service
        self.account = account
    }

    public func loadBearerToken() async throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data,
                  let token = String(data: data, encoding: .utf8) else {
                throw KeychainCredentialError.invalidStoredValue
            }
            return token
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainCredentialError.unexpectedStatus(status)
        }
    }

    public func saveBearerToken(_ token: String) async throws {
        let normalized = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            throw KeychainCredentialError.emptyToken
        }
        let data = Data(normalized.utf8)

        let updateStatus = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var attributes = baseQuery
            attributes[kSecValueData as String] = data
            attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(attributes as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainCredentialError.unexpectedStatus(addStatus)
            }
        default:
            throw KeychainCredentialError.unexpectedStatus(updateStatus)
        }
    }

    public func deleteBearerToken() async throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainCredentialError.unexpectedStatus(status)
        }
    }

    /// Deletes only the credential that triggered an authentication failure.
    /// The actor-isolated compare-and-delete prevents a stale request from
    /// removing a newer login that was saved while the request was in flight.
    @discardableResult
    public func deleteBearerToken(matching expectedToken: String) async throws -> Bool {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let readStatus = SecItemCopyMatching(query as CFDictionary, &result)
        switch readStatus {
        case errSecItemNotFound:
            return false
        case errSecSuccess:
            guard let data = result as? Data,
                  let storedToken = String(data: data, encoding: .utf8) else {
                throw KeychainCredentialError.invalidStoredValue
            }
            guard storedToken == expectedToken else { return false }
        default:
            throw KeychainCredentialError.unexpectedStatus(readStatus)
        }

        let deleteStatus = SecItemDelete(baseQuery as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            throw KeychainCredentialError.unexpectedStatus(deleteStatus)
        }
        return deleteStatus == errSecSuccess
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
        ]
    }
}

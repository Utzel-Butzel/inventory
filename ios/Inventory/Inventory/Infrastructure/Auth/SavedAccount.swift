import Foundation

/// The entire vault, including its active selection, is stored in one Keychain
/// item. A failed write therefore cannot leave a token paired with another host.
struct SavedAccountVault: Codable {
    var accounts: [SavedAccount] = []
    var activeAccountID: UUID?

    var activeAccount: SavedAccount? {
        accounts.first { $0.id == activeAccountID }
    }
}

struct SavedAccount: Codable, Identifiable {
    let id: UUID
    let serverAddress: String
    let principalIdentifier: String
    let label: String
    let token: String
    let method: StoredAuthenticationMethod
    let expiresAt: Date?
    var organizations: [InventoryOrganization]
    var activeOrganizationID: UUID?
    var userID: String? = nil

    var requiresSignIn: Bool {
        guard method == .login else { return false }
        guard let expiresAt else { return true }
        return expiresAt <= Date()
    }
}

enum StoredAuthenticationMethod: String, Codable {
    case login
    case apiToken
}

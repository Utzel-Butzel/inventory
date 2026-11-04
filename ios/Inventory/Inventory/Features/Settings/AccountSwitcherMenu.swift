import SwiftUI

struct AccountSwitcherMenu: View {
    @EnvironmentObject private var state: AppState
    @State private var showingSignIn = false
    @State private var errorMessage: String?
    @State private var signInServer = ""
    @State private var signInEmail = ""

    var body: some View {
        Menu {
            ForEach(state.savedAccounts) { account in
                Section("\(account.label) · \(account.serverAddress)") {
                    if account.organizations.isEmpty {
                        accountButton(account, organization: nil)
                    } else {
                        ForEach(account.organizations) { organization in
                            accountButton(account, organization: organization)
                        }
                    }
                }
            }
            Divider()
            Button {
                signInServer = ""
                signInEmail = ""
                showingSignIn = true
            } label: {
                Label(L10n.text("ui_add_account"), systemImage: "person.badge.plus")
            }
        } label: {
            Label(
                state.activeOrganization?.name ?? L10n.text("ui_accounts_organizations"),
                systemImage: "person.crop.circle"
            )
        }
        .accessibilityLabel(L10n.text("ui_accounts_organizations"))
        .disabled(state.isConnecting || state.restorationFailed)
        .sheet(isPresented: $showingSignIn) {
            SettingsView(
                onboarding: true,
                initialServer: signInServer,
                addingAccount: true,
                initialEmail: signInEmail,
                onConnected: { showingSignIn = false }
            )
        }
        .alert(L10n.text("ui_action_failed_3a20cc65"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.text("ui_sign_in_a329a322")) { showingSignIn = true }
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func accountButton(_ account: SavedAccount, organization: InventoryOrganization?) -> some View {
        Button {
            signInServer = account.serverAddress
            signInEmail = account.method == .login && account.label.contains("@") ? account.label : ""
            if account.requiresSignIn {
                showingSignIn = true
                return
            }
            Task {
                do {
                    try await state.switchAccount(to: account.id, organizationID: organization?.id)
                } catch is CancellationError {
                    return
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        } label: {
            Label(
                organization?.name ?? account.label,
                systemImage: state.isConfigured && account.id == state.activeAccountID &&
                    organization?.id == state.activeOrganization?.id ? "checkmark" : "building.2"
            )
        }
    }
}

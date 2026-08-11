import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var state: AppState
    @State private var server = ""
    @State private var email = ""
    @State private var password = ""
    @State private var token = ""
    @State private var showTokenLogin = false
    @State private var saving = false
    @State private var errorMessage: String?

    let onboarding: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    hero
                    connectionForm
                    if !onboarding && state.isConfigured { disconnectButton }
                }
                .padding(16)
            }
            .background(InventoryTheme.canvas)
            .navigationTitle(onboarding ? "Anmelden" : "Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if server.isEmpty { server = state.serverAddress }
            }
            .alert(
                "Aktion fehlgeschlagen",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private var hero: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(InventoryTheme.ink)
                    .frame(width: 56, height: 56)
                Image(systemName: "viewfinder.circle.fill")
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(InventoryTheme.lime)
            }
            Text("Inventory")
                .font(.title2.bold())
            Spacer()
        }
    }

    private var connectionForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            TextField("Server-URL", text: $server)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

            TextField("E-Mail", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

            SecureField("Passwort", text: $password)
                .textContentType(.password)
                .padding(13)
                .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))

            DisclosureGroup(isExpanded: $showTokenLogin) {
                SecureField("API-Token", text: $token)
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(13)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
                    .padding(.top, 10)
            } label: {
                Label("API-Token", systemImage: "key.fill")
                    .font(.subheadline.weight(.semibold))
            }
            .tint(InventoryTheme.ink)
            .onChange(of: showTokenLogin) { _, isExpanded in
                if !isExpanded { token = "" }
            }

            if server.lowercased().hasPrefix("http://") {
                Label(
                    "HTTP nur lokal.",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.caption)
                .foregroundStyle(InventoryTheme.warning)
            }

            Button {
                saveAndTest()
            } label: {
                HStack {
                    if saving { ProgressView().tint(.white) }
                    Text(saving ? "Anmelden …" : "Anmelden")
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .tint(InventoryTheme.ink)
            .disabled(saving || !canSubmit)

        }
        .inventoryCard()
    }

    private var disconnectButton: some View {
        Button(role: .destructive) {
            saving = true
            errorMessage = nil
            Task {
                do {
                    try await state.disconnect()
                } catch {
                    errorMessage = error.localizedDescription
                }
                saving = false
            }
        } label: {
            Label("Abmelden", systemImage: "rectangle.portrait.and.arrow.right")
                .frame(maxWidth: .infinity, minHeight: 46)
        }
        .buttonStyle(.bordered)
    }

    private func saveAndTest() {
        saving = true
        errorMessage = nil
        Task {
            do {
                let response: ResourceListResponse
                let normalizedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
                let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
                if !normalizedToken.isEmpty {
                    response = try await state.saveConfiguration(
                        server: server,
                        token: normalizedToken
                    )
                } else if !normalizedEmail.isEmpty || !password.isEmpty {
                    response = try await state.login(
                        server: server,
                        email: normalizedEmail,
                        password: password
                    )
                } else {
                    response = try await state.saveConfiguration(server: server, token: nil)
                }
                _ = response
                password = ""
                token = ""
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private var canSubmit: Bool {
        guard !server.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }
        if !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return true
        }
        let hasEmail = !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasPassword = !password.isEmpty
        if hasEmail || hasPassword { return hasEmail && hasPassword }
        return state.hasStoredToken
    }
}

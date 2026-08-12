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
            Group {
                if onboarding {
                    connectionPage
                } else {
                    settingsMenu
                }
            }
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

    private var connectionPage: some View {
        ScrollView {
            VStack(spacing: 14) {
                hero
                connectionForm
            }
            .padding(16)
        }
        .background(InventoryTheme.canvas)
        .navigationTitle(onboarding ? "Anmelden" : "Verbindung & Konto")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var settingsMenu: some View {
        List {
            Section("Aktivität") {
                NavigationLink {
                    UploadJobsView()
                } label: {
                    UploadSettingsLabel(queue: state.intakeQueue)
                }
            }

            Section("Arbeitsbereich") {
                NavigationLink {
                    InventoryTypesSettingsView(client: state.client)
                } label: {
                    settingsRow(
                        title: "Inventartypen",
                        subtitle: "Struktur, Container und Kartenzuordnung",
                        systemImage: "square.3.layers.3d"
                    )
                }

                NavigationLink {
                    CustomFieldsSettingsView(client: state.client)
                } label: {
                    settingsRow(
                        title: "Benutzerdefinierte Felder",
                        subtitle: "Zusätzliche Angaben für Inventar und Einheiten",
                        systemImage: "text.badge.plus"
                    )
                }
            }

            Section("Server & Zugriff") {
                NavigationLink {
                    RuntimeSettingsView(client: state.client)
                } label: {
                    settingsRow(
                        title: "Systemstatus",
                        subtitle: "Speicher, KI und Anmeldung",
                        systemImage: "server.rack"
                    )
                }

                NavigationLink {
                    PermissionsSettingsView(client: state.client)
                } label: {
                    settingsRow(
                        title: "Berechtigungen",
                        subtitle: "Konto, Rolle und gewährte Rechte",
                        systemImage: "checkmark.shield.fill"
                    )
                }
            }

            if state.canUseAI {
                Section("KI") {
                    Picker("Bildmodell", selection: imageModelSelection) {
                        Text(serverDefaultModelLabel)
                            .tag("")
                        ForEach(state.availableImageModels) { option in
                            Text(option.label)
                                .tag(option.id)
                        }
                        if let identifier = unavailableSelectedImageModelID {
                            Text("Gespeichert (\(identifier))")
                                .tag(identifier)
                        }
                    }
                    .pickerStyle(.navigationLink)

                    Text(imageModelHelpText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let webSettingsURL, let apiDocumentationURL {
                Section("Web") {
                    Link(destination: webSettingsURL) {
                        settingsRow(
                            title: "Webverwaltung",
                            subtitle: "Typen, Felder, Benutzer und API-Zugänge bearbeiten",
                            systemImage: "safari.fill"
                        )
                    }

                    Link(destination: apiDocumentationURL) {
                        settingsRow(
                            title: "API-Dokumentation",
                            subtitle: "Schnittstellen und Beispiele öffnen",
                            systemImage: "curlybraces.square.fill"
                        )
                    }
                }
            }

            Section("Konto") {
                NavigationLink {
                    connectionPage
                } label: {
                    settingsRow(
                        title: "Verbindung & Konto",
                        subtitle: state.serverAddress,
                        systemImage: "person.crop.circle.badge.checkmark"
                    )
                }

                disconnectButton
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(InventoryTheme.canvas)
        .navigationTitle("Einstellungen")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var webSettingsURL: URL? {
        state.client?.serverURL.appendingPathComponent("settings")
    }

    private var apiDocumentationURL: URL? {
        state.client?.serverURL.appendingPathComponent("api-docs")
    }

    private func settingsRow(
        title: String,
        subtitle: String? = nil,
        systemImage: String
    ) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .foregroundStyle(.primary)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(InventoryTheme.accent)
        }
    }

    private var imageModelSelection: Binding<String> {
        Binding(
            get: { state.selectedImageModelID ?? "" },
            set: { state.selectImageModel($0.isEmpty ? nil : $0) }
        )
    }

    private var serverDefaultModelLabel: String {
        guard let identifier = state.defaultImageModelID,
              let model = state.availableImageModels.first(where: { $0.id == identifier }) else {
            return "Server-Standard"
        }
        return "Server-Standard (\(model.label))"
    }

    private var unavailableSelectedImageModelID: String? {
        guard let identifier = state.selectedImageModelID,
              !state.availableImageModels.contains(where: { $0.id == identifier }) else {
            return nil
        }
        return identifier
    }

    private var imageModelHelpText: String {
        if state.availableImageModels.isEmpty {
            if let identifier = state.selectedImageModelID {
                return "Das gespeicherte Modell \(identifier) wird verwendet. Die Modellliste des Servers ist gerade nicht verfügbar."
            }
            return "Der Server bietet keine Modellauswahl an. Cover verwenden das Server-Standardmodell."
        }
        if let identifier = state.selectedImageModelID,
           let selected = state.availableImageModels.first(where: { $0.id == identifier }) {
            return "\(selected.provider) · \(selected.model). Die Auswahl gilt für neue Uploads."
        }
        return "Neue Cover verwenden das vom Server festgelegte Standardmodell."
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
                    Text(saveButtonTitle)
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
            disconnect()
        } label: {
            HStack {
                Label("Abmelden", systemImage: "rectangle.portrait.and.arrow.right")
                Spacer()
                if saving {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .disabled(saving)
    }

    private var saveButtonTitle: String {
        if saving { return onboarding ? "Anmelden …" : "Speichern …" }
        return onboarding ? "Anmelden" : "Verbindung speichern"
    }

    private func disconnect() {
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

private struct UploadSettingsLabel: View {
    @ObservedObject var queue: IntakeQueue

    var body: some View {
        Label {
            HStack {
                Text("Uploads")
                    .foregroundStyle(.primary)
                Spacer()
                if activeCount > 0 {
                    Text("\(activeCount)")
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(InventoryTheme.ink)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(InventoryTheme.lime, in: Capsule())
                } else if !queue.jobs.isEmpty {
                    Text("\(queue.jobs.count)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        } icon: {
            Image(systemName: "arrow.up.circle.fill")
                .foregroundStyle(InventoryTheme.accent)
        }
    }

    private var activeCount: Int {
        queue.jobs.filter { !$0.stage.isTerminal }.count
    }
}

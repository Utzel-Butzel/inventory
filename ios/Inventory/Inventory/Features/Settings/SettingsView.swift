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
        Form {
            if onboarding {
                Section {
                    Label("Inventory", systemImage: "viewfinder.circle")
                        .font(.title2.bold())
                }
            }

            Section("Server") {
                TextField("Server-URL", text: $server)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)

                if server.lowercased().hasPrefix("http://") {
                    Label("HTTP nur lokal verwenden.", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }

            Section("Konto") {
                TextField("E-Mail", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                SecureField("Passwort", text: $password)
                    .textContentType(.password)
            }

            Section {
                DisclosureGroup("API-Token", isExpanded: $showTokenLogin) {
                    SecureField("API-Token", text: $token)
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .onChange(of: showTokenLogin) { _, isExpanded in
                    if !isExpanded { token = "" }
                }
            } header: {
                Text("Alternative Anmeldung")
            } footer: {
                Text("Verwende alternativ einen persönlichen API-Token.")
            }

            Section {
                Button {
                    saveAndTest()
                } label: {
                    HStack {
                        Spacer()
                        if saving {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(saveButtonTitle)
                        Spacer()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(saving || !canSubmit)
            }
        }
        .navigationTitle(onboarding ? "Anmelden" : "Verbindung & Konto")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var settingsMenu: some View {
        List {
            if let activeOrganization = state.activeOrganization {
                Section {
                    if state.organizations.count > 1 {
                        Menu {
                            ForEach(state.organizations) { organization in
                                Button {
                                    switchOrganization(to: organization)
                                } label: {
                                    if organization.id == activeOrganization.id {
                                        Label(organization.name, systemImage: "checkmark")
                                    } else {
                                        Text(organization.name)
                                    }
                                }
                                .disabled(state.isSwitchingOrganization)
                            }
                        } label: {
                            organizationRow(activeOrganization, showsDisclosure: true)
                        }
                    } else {
                        organizationRow(activeOrganization, showsDisclosure: false)
                    }
                } header: {
                    Text("Organisation")
                } footer: {
                    Text("Inventar, Räume, Einstellungen und Uploads sind immer der ausgewählten Organisation zugeordnet.")
                }
            }

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
        .navigationTitle("Einstellungen")
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
        }
    }

    private func organizationRow(
        _ organization: InventoryOrganization,
        showsDisclosure: Bool
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "building.2.fill")
                .foregroundStyle(InventoryTheme.accent)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(organization.name)
                    .foregroundStyle(.primary)
                Text(organization.roleName ?? organization.role ?? organization.slug)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if state.isSwitchingOrganization {
                ProgressView()
                    .controlSize(.small)
            } else if showsDisclosure {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
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

    private func switchOrganization(to organization: InventoryOrganization) {
        guard organization.id != state.activeOrganization?.id,
              !state.isSwitchingOrganization else { return }
        errorMessage = nil
        Task {
            do {
                try await state.switchOrganization(to: organization.id)
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
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
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                } else if !queue.visibleJobs.isEmpty {
                    Text("\(queue.visibleJobs.count)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        } icon: {
            Image(systemName: "arrow.up.circle")
        }
    }

    private var activeCount: Int {
        queue.visibleJobs.filter { !$0.stage.isTerminal }.count
    }
}

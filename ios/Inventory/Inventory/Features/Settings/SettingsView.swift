import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var server = ""
    @State private var email = ""
    @State private var password = ""
    @State private var token = ""
    @State private var showTokenLogin = false
    @State private var saving = false
    @State private var errorMessage: String?
    @StateObject private var browserAuthentication = BrowserAuthentication()
    @State private var privateBrowserSession = false
    @State private var authOptions: ServerAuthOptions?
    @State private var authOptionsServer = ""
    @State private var authOptionsFailed = false
    @State private var checkingAuthOptions = false

    let onboarding: Bool
    var initialServer: String? = nil
    var addingAccount = false
    var initialEmail = ""
    var onConnected: (() -> Void)? = nil

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
                if server.isEmpty { server = initialServer ?? state.serverAddress }
                if email.isEmpty { email = initialEmail }
            }
            .toolbar {
                if addingAccount {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(L10n.text("ui_cancel_f7ff1178")) { dismiss() }
                            .disabled(saving)
                    }
                }
            }
            .alert(
                L10n.text("ui_action_failed_3a20cc65"),
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
            }
        }
        .interactiveDismissDisabled(saving)
    }

    private var connectionPage: some View {
        Form {
            if !addingAccount, !state.savedAccounts.isEmpty {
                Section { AccountSwitcherMenu() }
            }
            if let message = state.configurationError {
                Section {
                    Label(message, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                }
            }
            if onboarding {
                Section {
                    Label("Inventory", systemImage: "viewfinder.circle")
                        .font(.title2.bold())
                }
            }

            Section(L10n.text("ui_server_aef7de28")) {
                TextField(L10n.text("ui_server_url_6abdb8cf"), text: $server)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)

                if server.lowercased().hasPrefix("http://") {
                    Label(L10n.text("ui_use_http_only_locally_c4b27a2e"), systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }

            if currentAuthOptions?.browserSignIn == true, currentAuthOptions?.providers.isEmpty == false {
            Section {
                Button {
                    signInWithBrowser()
                } label: {
                    Label(browserSignInLabel, systemImage: "person.badge.key.fill")
                }
                .disabled(saving || server.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Toggle(L10n.text("ui_browser_sign_in_other_account"), isOn: $privateBrowserSession)
                    .disabled(saving)
            } footer: {
                Text(L10n.text("ui_browser_sign_in_help"))
            }

            }
            if checkingAuthOptions {
                ProgressView(L10n.text("ui_loading_sign_in_options"))
            } else if authOptionsFailed {
                Section {
                    Text(L10n.text("ui_sign_in_options_unavailable"))
                        .font(.caption).foregroundStyle(.secondary)
                    Button(L10n.text("ui_retry_session")) { Task { await loadAuthOptions() } }
                }
            }

            if currentAuthOptions?.passwordEnabled != false {
            Section(L10n.text("ui_account_df852501")) {
                TextField(L10n.text("ui_email_2fae6fb3"), text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                SecureField(L10n.text("ui_password_a36c1015"), text: $password)
                    .textContentType(.password)
            }

            }
            Section {
                DisclosureGroup(L10n.text("ui_api_token_5efaaeee"), isExpanded: $showTokenLogin) {
                    SecureField(L10n.text("ui_api_token_5efaaeee"), text: $token)
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .onChange(of: showTokenLogin) { _, isExpanded in
                    if !isExpanded { token = "" }
                }
            } header: {
                Text(L10n.text("ui_alternative_sign_in_1793e2f6"))
            } footer: {
                Text(L10n.text("ui_alternatively_use_a_personal_api_token_628a5e62"))
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
            if onboarding {
                Section {
                    Button(L10n.text("ui_try_the_demo_b632930d")) {
                        server = "https://demo.openinventory.polyxo.de"
                        token = "inv_demo_public_openinventory"
                        saveAndTest()
                    }
                    .disabled(saving)
                } footer: {
                    Text(L10n.text("ui_view_public_sample_data_changes_and_uploads_bc2650dd"))
                }
            }
            privacyLinks
        }
        .task(id: server) { await loadAuthOptions() }
        .navigationTitle(onboarding ? L10n.text("ui_sign_in_a329a322") : L10n.text("ui_connection_account_754ae37d"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var settingsMenu: some View {
        List {
            Section {
                AccountSwitcherMenu()
                Text(state.serverAddress)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text(L10n.text("ui_accounts_organizations"))
            }

            Section(L10n.text("ui_activity_46f08d7f")) {
                if state.canReadRequests {
                    NavigationLink {
                        InternalRequestsView()
                    } label: {
                        settingsRow(
                            title: L10n.text("ui_internal_requests_32dc9d5c"),
                            subtitle: L10n.text("ui_review_approve_and_fulfill_225176d8"),
                            systemImage: "clipboard"
                        )
                    }
                }

                if state.canReadAssignments {
                    NavigationLink {
                        LoansOverviewView()
                    } label: {
                        settingsRow(
                            title: L10n.text("ui_loans_reservations_8cafe909"),
                            subtitle: L10n.text("ui_active_overdue_and_completed_5d801a9c"),
                            systemImage: "person.crop.circle.badge.clock"
                        )
                    }
                }

                NavigationLink {
                    NotificationInboxView()
                } label: {
                    settingsRow(
                        title: L10n.text("ui_notifications_f7205df4"),
                        subtitle: L10n.text("ui_stock_deadlines_and_returns_15003d7a"),
                        systemImage: "bell.badge"
                    )
                }

                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    settingsRow(
                        title: L10n.text("ui_notification_rules_154e021e"),
                        subtitle: L10n.text("ui_events_thresholds_and_channels_6ce7ccc9"),
                        systemImage: "bell.and.waves.left.and.right"
                    )
                }

                NavigationLink {
                    UploadJobsView()
                } label: {
                    UploadSettingsLabel(queue: state.intakeQueue)
                }
            }

            Section(L10n.text("ui_images_214feaf1")) {
                Picker(L10n.text("ui_maximum_image_dimension_6b755cdf"), selection: maximumUploadImagePixelSizeSelection) {
                    ForEach(ImageSizePreferences.uploadPixelSizes, id: \.self) { pixelSize in
                        Text(imageSizeLabel(pixelSize))
                            .tag(pixelSize)
                    }
                }
                .pickerStyle(.navigationLink)

                Text(L10n.text("ui_larger_new_inventory_images_are_resized_proportionally_9b5e4f3d"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section(L10n.text("ui_workspace_6a85b576")) {
                NavigationLink {
                    InventoryTypesSettingsView(client: state.client)
                } label: {
                    settingsRow(
                        title: L10n.text("ui_inventory_types_d81903f7"),
                        subtitle: L10n.text("ui_structure_containers_and_map_assignment_77e898c0"),
                        systemImage: "square.3.layers.3d"
                    )
                }

                NavigationLink {
                    CustomFieldsSettingsView(client: state.client)
                } label: {
                    settingsRow(
                        title: L10n.text("ui_custom_fields_30214611"),
                        subtitle: L10n.text("ui_additional_details_for_inventory_and_units_08f03523"),
                        systemImage: "text.badge.plus"
                    )
                }
            }

            Section(L10n.text("ui_server_access_cabfaaf0")) {
                NavigationLink {
                    RuntimeSettingsView(client: state.client)
                } label: {
                    settingsRow(
                        title: L10n.text("ui_system_status_8d5cb1ee"),
                        subtitle: L10n.text("ui_storage_ai_and_authentication_06537345"),
                        systemImage: "server.rack"
                    )
                }

                NavigationLink {
                    PermissionsSettingsView(client: state.client)
                } label: {
                    settingsRow(
                        title: L10n.text("ui_permissions_036b749f"),
                        subtitle: L10n.text("ui_account_role_and_granted_permissions_7ecbedb8"),
                        systemImage: "checkmark.shield.fill"
                    )
                }
            }

            if state.canUseAI {
                Section(L10n.text("ui_ai_fd184691")) {
                    Picker(L10n.text("ui_image_model_04f87c78"), selection: imageModelSelection) {
                        Text(serverDefaultModelLabel)
                            .tag("")
                        ForEach(state.availableImageModels) { option in
                            Text(option.label)
                                .tag(option.id)
                        }
                        if let identifier = unavailableSelectedImageModelID {
                            Text(L10n.text("ui_saved_0_d1e709ae", identifier))
                                .tag(identifier)
                        }
                    }
                    .pickerStyle(.navigationLink)

                    Text(imageModelHelpText)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Picker(
                        L10n.text("ui_maximum_generated_image_dimension_40356102"),
                        selection: maximumAIGeneratedImagePixelSizeSelection
                    ) {
                        ForEach(ImageSizePreferences.aiGeneratedPixelSizes, id: \.self) { pixelSize in
                            Text(imageSizeLabel(pixelSize))
                                .tag(pixelSize)
                        }
                    }
                    .pickerStyle(.navigationLink)

                    Text(L10n.text("ui_this_selection_applies_to_new_ai_covers_10844930"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    NavigationLink {
                        AIPromptEditorView(
                            title: L10n.text("ui_analysis_prompt_016f1081"),
                            prompt: state.analysisPrompt,
                            helpText: L10n.text("ui_replaces_the_server_default_for_analyzing_photos_d645db1c"),
                            onSave: state.setAnalysisPrompt
                        )
                    } label: {
                        settingsRow(
                            title: L10n.text("ui_analysis_d8673f98"),
                            subtitle: promptStatus(state.analysisPrompt),
                            systemImage: "text.magnifyingglass"
                        )
                    }

                    NavigationLink {
                        AIPromptEditorView(
                            title: L10n.text("ui_cover_prompt_176df793"),
                            prompt: state.coverPrompt,
                            helpText: L10n.text("ui_replaces_the_server_default_for_generating_standard_5726718b"),
                            onSave: state.setCoverPrompt
                        )
                    } label: {
                        settingsRow(
                            title: L10n.text("ui_cover_fa8d8456"),
                            subtitle: promptStatus(state.coverPrompt),
                            systemImage: "photo.badge.plus"
                        )
                    }

                    NavigationLink {
                        AIPromptEditorView(
                            title: L10n.text("ui_transparent_cover_prompt_5a54cad6"),
                            prompt: state.transparentCoverPrompt,
                            helpText: L10n.text("ui_replaces_the_server_default_for_transparent_covers_d1e39fa1"),
                            onSave: state.setTransparentCoverPrompt
                        )
                    } label: {
                        settingsRow(
                            title: L10n.text("ui_transparent_cover_9016a9c5"),
                            subtitle: promptStatus(state.transparentCoverPrompt),
                            systemImage: "square.dashed"
                        )
                    }
                } header: {
                    Text(L10n.text("ui_ai_prompts_50c16641"))
                } footer: {
                    Text(L10n.text("ui_custom_prompts_completely_replace_the_corresponding_server_4f75efdd"))
                }
            }

            if state.canUseAI || state.canManageAISettings {
                Section(L10n.text("ui_organization_ai_defaults_c446f097")) {
                    NavigationLink {
                        InventoryAISettingsView()
                    } label: {
                        settingsRow(title: L10n.text("ui_analysis_and_research_50c89e4e"), subtitle: L10n.text("ui_models_language_automation_and_text_templates_6382e98c"), systemImage: "sparkles")
                    }
                }

            }

            if let webSettingsURL, let apiDocumentationURL {
                Section(L10n.text("ui_web_29751047")) {
                    if state.canManageWorkflows, let client = state.client, let organization = state.activeOrganization {
                        Link(destination: client.serverURL.appendingPathComponent(organization.slug).appendingPathComponent("settings/action-flows")) {
                            settingsRow(title: L10n.text("ui_edit_workflows_4789113d"), subtitle: L10n.text("ui_configure_steps_variants_and_scan_inputs_82e0d2a6"), systemImage: "list.bullet.rectangle")
                        }
                    }
                    Link(destination: webSettingsURL) {
                        settingsRow(
                            title: L10n.text("ui_web_administration_13037711"),
                            subtitle: L10n.text("ui_edit_types_fields_users_and_api_access_3113a1ac"),
                            systemImage: "safari.fill"
                        )
                    }

                    Link(destination: apiDocumentationURL) {
                        settingsRow(
                            title: L10n.text("ui_api_documentation_7b2502db"),
                            subtitle: L10n.text("ui_open_interfaces_and_examples_6bcd41db"),
                            systemImage: "curlybraces.square.fill"
                        )
                    }
                }
            }

            privacyLinks

            Section(L10n.text("ui_account_df852501")) {
                NavigationLink {
                    connectionPage
                } label: {
                    settingsRow(
                        title: L10n.text("ui_connection_account_754ae37d"),
                        subtitle: state.serverAddress,
                        systemImage: "person.crop.circle.badge.checkmark"
                    )
                }

                disconnectButton
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(L10n.text("ui_settings_f5750a5d"))
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

    private var imageModelSelection: Binding<String> {
        Binding(
            get: { state.selectedImageModelID ?? "" },
            set: { state.selectImageModel($0.isEmpty ? nil : $0) }
        )
    }

    private var maximumUploadImagePixelSizeSelection: Binding<Int> {
        Binding(
            get: { state.maximumUploadImagePixelSize },
            set: { state.setMaximumUploadImagePixelSize($0) }
        )
    }

    private var maximumAIGeneratedImagePixelSizeSelection: Binding<Int> {
        Binding(
            get: { state.maximumAIGeneratedImagePixelSize },
            set: { state.setMaximumAIGeneratedImagePixelSize($0) }
        )
    }

    private func imageSizeLabel(_ pixelSize: Int) -> String {
        "\(pixelSize.formatted()) px"
    }

    private func promptStatus(_ prompt: String?) -> String {
        prompt == nil ? L10n.text("ui_server_default_354eeea6") : L10n.text("ui_custom_prompt_c7f0391c")
    }

    private var serverDefaultModelLabel: String {
        guard let identifier = state.defaultImageModelID,
              let model = state.availableImageModels.first(where: { $0.id == identifier }) else {
            return L10n.text("ui_server_default_354eeea6")
        }
        return L10n.text("ui_server_default_0_32efb0f2", model.label)
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
                return L10n.text("ui_the_saved_model_0_is_used_the_417753cc", identifier)
            }
            return L10n.text("ui_the_server_does_not_offer_a_model_5feb6b85")
        }
        if let identifier = state.selectedImageModelID,
           let selected = state.availableImageModels.first(where: { $0.id == identifier }) {
            return L10n.text("ui_0_1_this_selection_applies_to_new_c6ec8488", selected.provider, selected.model)
        }
        return L10n.text("ui_new_covers_use_the_default_model_configured_51088c0f")
    }

    private var disconnectButton: some View {
        Button(role: .destructive) {
            disconnect()
        } label: {
            HStack {
                Label(L10n.text("ui_sign_out_545f8be3"), systemImage: "rectangle.portrait.and.arrow.right")
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
        if saving { return onboarding ? L10n.text("ui_signing_in_223a120e") : L10n.text("ui_saving_59cc60f1") }
        return onboarding ? L10n.text("ui_sign_in_a329a322") : L10n.text("ui_save_connection_17b40899")
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

    private var privacyLinks: some View {
        Section(L10n.text("ui_open_inventory_166dbd73")) {
            Link(L10n.text("ui_privacy_f624fcf0"), destination: URL(string: "https://openinventory.polyxo.de/\(L10n.language == "de" ? "de/" : "")app/privacy")!)
            Link(L10n.text("ui_help_contact_5109b38a"), destination: URL(string: "https://openinventory.polyxo.de/\(L10n.language == "de" ? "de/" : "")app/support")!)
        }
    }

    private var currentAuthOptions: ServerAuthOptions? {
        authOptionsServer == server.trimmingCharacters(in: .whitespacesAndNewlines) ? authOptions : nil
    }

    private var browserSignInLabel: String {
        guard let providers = currentAuthOptions?.providers, providers.count == 1 else {
            return L10n.text("ui_browser_sign_in")
        }
        return L10n.text("ui_sign_in_with_provider", providers[0].name)
    }

    private func loadAuthOptions() async {
        let address = server.trimmingCharacters(in: .whitespacesAndNewlines)
        authOptions = nil
        authOptionsServer = address
        authOptionsFailed = false
        checkingAuthOptions = false
        guard let url = URL(string: address),
              let client = try? APIClient(serverURL: url, credentialStore: InMemoryCredentialStore()) else { return }
        checkingAuthOptions = true
        do {
            try await Task.sleep(for: .milliseconds(400))
            let options = try await client.authOptions()
            try Task.checkCancellation()
            guard server.trimmingCharacters(in: .whitespacesAndNewlines) == address else { return }
            authOptions = options
            checkingAuthOptions = false
        } catch {
            guard !Task.isCancelled, server.trimmingCharacters(in: .whitespacesAndNewlines) == address else { return }
            checkingAuthOptions = false
            authOptionsFailed = true
        }
    }

    private func signInWithBrowser() {
        guard currentAuthOptions?.browserSignIn == true else { return }
        saving = true
        errorMessage = nil
        Task {
            defer { saving = false }
            do {
                _ = try await state.loginWithBrowser(
                    server: server,
                    privateSession: privateBrowserSession,
                    authenticate: { url, privateSession in
                        try await browserAuthentication.authenticate(url: url, privateSession: privateSession)
                    }
                )
                password = ""
                token = ""
                onConnected?()
            } catch is CancellationError {
                // Closing the browser leaves all saved accounts unchanged.
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
                onConnected?()
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
        if hasEmail || hasPassword { return currentAuthOptions?.passwordEnabled != false && hasEmail && hasPassword }
        return !addingAccount && state.hasStoredToken
    }
}

private struct AIPromptEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: String

    let title: String
    let helpText: String
    let onSave: (String?) -> Void

    init(
        title: String,
        prompt: String?,
        helpText: String,
        onSave: @escaping (String?) -> Void
    ) {
        self.title = title
        self.helpText = helpText
        self.onSave = onSave
        _draft = State(initialValue: prompt ?? "")
    }

    var body: some View {
        Form {
            Section {
                TextEditor(text: $draft)
                    .frame(minHeight: 260)
                    .textInputAutocapitalization(.sentences)
                    .autocorrectionDisabled(false)
            } header: {
                HStack {
                    Text(L10n.text("ui_prompt_5c391238"))
                    Spacer()
                    Text("\(draft.utf16.count.formatted()) / \(AIPromptPreferences.maximumUTF16Length.formatted())")
                        .foregroundStyle(isTooLong ? Color.red : Color.secondary)
                        .monospacedDigit()
                }
            } footer: {
                Text(L10n.text("ui_0_leave_the_field_empty_to_use_317e37d2", helpText))
            }

            if !draft.isEmpty {
                Section {
                    Button(L10n.text("ui_use_server_default_9cbedd11")) {
                        draft = ""
                    }
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(L10n.text("ui_save_f6b2ff39")) {
                    onSave(draft)
                    dismiss()
                }
                .disabled(isTooLong)
            }
        }
    }

    private var isTooLong: Bool {
        draft.utf16.count > AIPromptPreferences.maximumUTF16Length
    }
}

private struct UploadSettingsLabel: View {
    @ObservedObject var queue: IntakeQueue

    var body: some View {
        Label {
            HStack {
                Text(L10n.text("ui_uploads_d084236c"))
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

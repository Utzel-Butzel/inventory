import SwiftUI

struct RuntimeSettingsView: View {
    let client: APIClient?

    @State private var status: RuntimeSettingsResponse?
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let status {
                Section(L10n.text("ui_services_a6f5acc6")) {
                    SettingsStatusRow(
                        title: L10n.text("ui_file_storage_96e9a252"),
                        detail: "\(status.storage.provider.capitalized)-Anbieter",
                        systemImage: status.storage.provider == "local" ? "internaldrive.fill" : "cloud.fill",
                        available: status.storage.configured
                    )
                    SettingsStatusRow(
                        title: L10n.text("ui_ai_analysis_5684fb9f"),
                        detail: L10n.text("ui_metadata_and_image_recognition_88d6218b"),
                        systemImage: "sparkles",
                        available: status.ai.analysis
                    )
                    SettingsStatusRow(
                        title: L10n.text("ui_image_generation_fe55be15"),
                        detail: "\(status.ai.imageProvider.capitalized)-Anbieter",
                        systemImage: "photo.badge.plus",
                        available: status.ai.imageGeneration
                    )
                }

                Section(L10n.text("ui_authentication_32ddf6ae")) {
                    SettingsStatusRow(
                        title: L10n.text("ui_password_sign_in_d542866d"),
                        detail: L10n.text("ui_local_user_accounts_3354b7e2"),
                        systemImage: "key.fill",
                        available: status.auth.password
                    )
                    SettingsStatusRow(
                        title: "Auth0",
                        detail: L10n.text("ui_external_identity_provider_76eba2a0"),
                        systemImage: "person.badge.shield.checkmark.fill",
                        available: status.auth.auth0
                    )
                    ForEach((status.auth.providers ?? []).filter { $0.id != "auth0" }) { provider in
                        SettingsStatusRow(
                            title: provider.name,
                            detail: L10n.text("ui_external_identity_provider_76eba2a0"),
                            systemImage: "person.badge.shield.checkmark.fill",
                            available: true
                        )
                    }
                }
            } else if loading {
                SettingsLoadingRow(text: L10n.text("ui_loading_system_status_c18de017"))
            } else {
                SettingsErrorRow(message: errorMessage ?? L10n.text("ui_system_status_is_unavailable_6dfcc08d"))
            }

            Section {
                Text(L10n.text("ui_these_details_are_determined_by_the_server_eda7a873"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(L10n.text("ui_system_status_8d5cb1ee"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: client?.contextIdentifier) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    @MainActor
    private func load() async {
        guard let client else {
            status = nil
            loading = false
            errorMessage = L10n.text("ui_there_is_no_connection_to_the_server_b10e907a")
            return
        }

        loading = status == nil
        errorMessage = nil
        do {
            status = try await client.runtimeSettings()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}

struct PermissionsSettingsView: View {
    let client: APIClient?

    @State private var capabilities: CapabilitiesResponse?
    @State private var runtime: RuntimeSettingsResponse?
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let capabilities {
                Section(L10n.text("ui_identity_09841f4a")) {
                    LabeledContent(L10n.text("ui_name_dcd1d522"), value: capabilities.name)
                    LabeledContent(L10n.text("ui_role_0038a9cf"), value: roleLabel)
                }

                Section(L10n.text("ui_permissions_036b749f")) {
                    ForEach(orderedScopes, id: \.self) { scope in
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(scopeTitle(scope))
                                Text(scopeDescription(scope))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: scopeIcon(scope))
                        }
                    }
                }
            } else if loading {
                SettingsLoadingRow(text: L10n.text("ui_loading_permissions_0646e881"))
            } else {
                SettingsErrorRow(message: errorMessage ?? L10n.text("ui_permissions_are_unavailable_7cab1d18"))
            }

            Section {
                Text(L10n.text("ui_the_app_shows_permissions_granted_by_the_c8042c25"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(L10n.text("ui_permissions_036b749f"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: client?.contextIdentifier) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private var roleLabel: String {
        switch runtime?.user.role {
        case "admin": L10n.text("ui_administrator_e7d3e769")
        case "editor": L10n.text("ui_edit_84e45ee7")
        case "viewer": L10n.text("ui_read_only_bba5cbd1")
        case .some(let role): role.capitalized
        case nil: L10n.text("ui_api_token_5efaaeee")
        }
    }

    private var orderedScopes: [String] {
        let preferred = ["read", "write", "ai"]
        let available = Set(capabilities?.scopes ?? [])
        return preferred.filter(available.contains) + available.subtracting(preferred).sorted()
    }

    @MainActor
    private func load() async {
        guard let client else {
            capabilities = nil
            runtime = nil
            loading = false
            errorMessage = L10n.text("ui_there_is_no_connection_to_the_server_b10e907a")
            return
        }

        loading = capabilities == nil
        errorMessage = nil
        do {
            async let capabilitiesRequest = client.capabilities()
            async let runtimeRequest = client.runtimeSettings()
            let (nextCapabilities, nextRuntime) = try await (
                capabilitiesRequest,
                runtimeRequest
            )
            capabilities = nextCapabilities
            runtime = nextRuntime
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    private func scopeTitle(_ scope: String) -> String {
        switch scope {
        case "read": L10n.text("ui_read_dca8f649")
        case "write": L10n.text("ui_edit_84e45ee7")
        case "ai": L10n.text("ui_ai_features_c946a780")
        default: scope
        }
    }

    private func scopeDescription(_ scope: String) -> String {
        switch scope {
        case "read": L10n.text("ui_view_inventory_media_and_statistics_47b808dd")
        case "write": L10n.text("ui_change_inventory_stock_and_uploads_6b4b752c")
        case "ai": L10n.text("ui_use_analysis_and_image_generation_9be07733")
        default: L10n.text("ui_permission_granted_by_the_server_f61a7724")
        }
    }

    private func scopeIcon(_ scope: String) -> String {
        switch scope {
        case "read": "eye.fill"
        case "write": "square.and.pencil"
        case "ai": "sparkles"
        default: "checkmark.shield.fill"
        }
    }
}

private struct SettingsStatusRow: View {
    let title: String
    let detail: String
    let systemImage: String
    let available: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .frame(width: 24)
                .foregroundStyle(available ? .primary : .secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Label(
                available ? L10n.text("ui_ready_8d4d4830") : L10n.text("ui_not_configured_2fed0df5"),
                systemImage: available ? "checkmark.circle.fill" : "minus.circle"
            )
            .font(.caption)
            .foregroundStyle(available ? .green : .secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct SettingsLoadingRow: View {
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(text)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SettingsErrorRow: View {
    let message: String

    var body: some View {
        Label {
            Text(message)
                .foregroundStyle(.secondary)
        } icon: {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(.orange)
        }
    }
}

struct InventoryTypesSettingsView: View {
    let client: APIClient?

    @State private var types: [InventoryTypeDefinition] = []
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if !types.isEmpty {
                Section(L10n.text("ui_active_types_92f2b518")) {
                    ForEach(types) { type in
                        NavigationLink {
                            InventoryTypeSettingsDetailView(type: type)
                        } label: {
                            InventoryTypeSettingsRow(type: type)
                        }
                    }
                }
            } else if loading {
                SettingsLoadingRow(text: L10n.text("ui_loading_inventory_types_9d43dc6d"))
            } else if let errorMessage {
                SettingsErrorRow(message: errorMessage)
            } else {
                Section {
                    Label(L10n.text("ui_no_inventory_types_available_d9d75448"), systemImage: "shippingbox")
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Text(L10n.text("ui_inventory_types_define_which_items_can_be_2b874411"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(L10n.text("ui_inventory_types_d81903f7"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: client?.contextIdentifier) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    @MainActor
    private func load() async {
        guard let client else {
            types = []
            loading = false
            errorMessage = L10n.text("ui_there_is_no_connection_to_the_server_b10e907a")
            return
        }

        loading = types.isEmpty
        errorMessage = nil
        do {
            let response = try await client.inventoryTypes()
            types = response.types.sorted {
                $0.position == $1.position
                    ? $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
                    : $0.position < $1.position
            }
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}

private struct InventoryTypeSettingsRow: View {
    let type: InventoryTypeDefinition

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(settingsColor(type.color))
                .frame(width: 12, height: 12)
                .overlay {
                    Circle().stroke(.primary.opacity(0.12), lineWidth: 1)
                }

            VStack(alignment: .leading, spacing: 3) {
                Text(type.label)
                HStack(spacing: 6) {
                    Text(type.key)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    if type.canContain {
                        Text(L10n.text("ui_container_0c7823e8"))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct InventoryTypeSettingsDetailView: View {
    let type: InventoryTypeDefinition

    var body: some View {
        List {
            Section(L10n.text("ui_type_1b024183")) {
                HStack {
                    Circle()
                        .fill(settingsColor(type.color))
                        .frame(width: 16, height: 16)
                    Text(type.label)
                    Spacer()
                    if type.isSystem {
                        Text(L10n.text("ui_system_6725e7bb"))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                LabeledContent(L10n.text("ui_api_key_de526edf"), value: type.key)
                if !type.description.isEmpty {
                    Text(type.description)
                        .foregroundStyle(.secondary)
                }
            }

            Section(L10n.text("ui_structure_22650066")) {
                LabeledContent(L10n.text("ui_can_contain_items_2fbf4eac")) {
                    SettingsBooleanValue(value: type.canContain)
                }
                LabeledContent(L10n.text("ui_automatically_from_map_b9613ded")) {
                    SettingsBooleanValue(value: type.spatialContainment)
                }
                LabeledContent(L10n.text("ui_sort_order_59ff9eb1"), value: "\(type.position)")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(type.label)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct CustomFieldsSettingsView: View {
    let client: APIClient?

    @State private var definitions: [CustomFieldDefinition] = []
    @State private var selectedEntity: CustomFieldEntityType = .inventory
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Picker(L10n.text("ui_scope_14d5fc54"), selection: $selectedEntity) {
                    Text(L10n.text("ui_inventory_d602900f")).tag(CustomFieldEntityType.inventory)
                    Text(L10n.text("ui_stock_units_f2f3b419")).tag(CustomFieldEntityType.stockUnit)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            if !visibleDefinitions.isEmpty {
                Section(L10n.text("ui_fields_b26f0b11")) {
                    ForEach(visibleDefinitions) { definition in
                        NavigationLink {
                            CustomFieldSettingsDetailView(definition: definition)
                        } label: {
                            CustomFieldSettingsRow(definition: definition)
                        }
                    }
                }
            } else if loading {
                SettingsLoadingRow(text: L10n.text("ui_loading_custom_fields_2b0960ae"))
            } else if let errorMessage {
                SettingsErrorRow(message: errorMessage)
            } else {
                Section {
                    Label(
                        selectedEntity == .inventory
                            ? L10n.text("ui_no_additional_inventory_fields_8d380066")
                            : L10n.text("ui_no_additional_stock_unit_fields_2a95c9f5"),
                        systemImage: "text.badge.plus"
                    )
                    .foregroundStyle(.secondary)
                }
            }

            Section {
                Text(L10n.text("ui_field_definitions_and_their_target_groups_are_2424101a"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(L10n.text("ui_custom_fields_ad9feea0"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: client?.contextIdentifier) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private var visibleDefinitions: [CustomFieldDefinition] {
        definitions
            .filter { $0.entityType == selectedEntity }
            .sorted {
                $0.position == $1.position
                    ? $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
                    : $0.position < $1.position
            }
    }

    @MainActor
    private func load() async {
        guard let client else {
            definitions = []
            loading = false
            errorMessage = L10n.text("ui_there_is_no_connection_to_the_server_b10e907a")
            return
        }

        loading = definitions.isEmpty
        errorMessage = nil
        do {
            definitions = try await client.customFieldDefinitions().definitions
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}

private struct CustomFieldSettingsRow: View {
    let definition: CustomFieldDefinition

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(definition.label)
                    if definition.required {
                        Text(L10n.text("ui_required_6a047fec"))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.orange)
                    }
                }
                Text("\(definition.key) · \(definition.fieldType.localizedTitle)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: definition.fieldType.systemImage)
        }
    }
}

private struct CustomFieldSettingsDetailView: View {
    let definition: CustomFieldDefinition

    var body: some View {
        List {
            Section(L10n.text("ui_field_1dbe99d0")) {
                LabeledContent(L10n.text("ui_api_key_de526edf"), value: definition.key)
                LabeledContent(L10n.text("ui_field_type_7bc04652"), value: definition.fieldType.localizedTitle)
                LabeledContent(L10n.text("ui_required_field_f5fd476d")) {
                    SettingsBooleanValue(value: definition.required)
                }
                LabeledContent(L10n.text("ui_sort_order_59ff9eb1"), value: "\(definition.position)")
                if !definition.description.isEmpty {
                    LabeledContent(L10n.text("ui_description_e9262f00")) {
                        Text(definition.description)
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(.secondary)
                    }
                }
                if !definition.placeholder.isEmpty {
                    LabeledContent(L10n.text("ui_placeholder_71b40529"), value: definition.placeholder)
                }
            }

            if definition.fieldType == .number {
                Section(L10n.text("ui_number_range_7ce367f3")) {
                    if let minimum = definition.minValue {
                        LabeledContent(L10n.text("ui_minimum_735beee2"), value: formattedNumber(minimum))
                    }
                    if let maximum = definition.maxValue {
                        LabeledContent(L10n.text("ui_maximum_66c9ab17"), value: formattedNumber(maximum))
                    }
                    if let step = definition.step {
                        LabeledContent(L10n.text("ui_step_size_0d1486f0"), value: formattedNumber(step))
                    }
                    if definition.minValue == nil,
                       definition.maxValue == nil,
                       definition.step == nil {
                        Text(L10n.text("ui_no_restrictions_b6305eb6"))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !definition.options.isEmpty {
                Section(L10n.text("ui_selection_options_d6d60efe")) {
                    ForEach(definition.options) { option in
                        HStack(spacing: 10) {
                            Circle()
                                .fill(settingsColor(option.color ?? ""))
                                .frame(width: 10, height: 10)
                            Text(option.label)
                            Spacer()
                            Text(option.value)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section(L10n.text("ui_applies_to_ce7db2e0")) {
                LabeledContent(L10n.text("ui_inventory_types_d81903f7")) {
                    Text(definition.resourceTypes.isEmpty
                         ? L10n.text("ui_all_3801a35c")
                         : definition.resourceTypes.joined(separator: ", "))
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent(L10n.text("ui_categories_055b8f9b")) {
                    Text(definition.categories.isEmpty
                         ? L10n.text("ui_all_3801a35c")
                         : definition.categories.joined(separator: ", "))
                        .multilineTextAlignment(.trailing)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(definition.label)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func formattedNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0 ... 4)))
    }
}

private struct SettingsBooleanValue: View {
    let value: Bool

    var body: some View {
        Label(value ? L10n.text("ui_yes_cde9e58a") : L10n.text("ui_no_90ebc1bd"), systemImage: value ? "checkmark.circle.fill" : "minus.circle")
            .labelStyle(.titleAndIcon)
            .foregroundStyle(value ? .green : .secondary)
    }
}

private extension CustomFieldValueType {
    var localizedTitle: String {
        switch self {
        case .text: L10n.text("ui_text_71988c4d")
        case .textarea: L10n.text("ui_long_text_9aa0d7b3")
        case .number: L10n.text("ui_number_654eb4c0")
        case .boolean: L10n.text("ui_yes_no_0b90ccd2")
        case .date: L10n.text("ui_date_9135882d")
        case .datetime: L10n.text("ui_date_and_time_5e69bd74")
        case .select: L10n.text("ui_selection_e8b7adc3")
        case .multiSelect: L10n.text("ui_multiple_selection_1d8a827e")
        case .reference: L10n.text("ui_reference_e1311398")
        case .email: L10n.text("ui_email_address_c2f9765a")
        case .url: "URL"
        }
    }

    var systemImage: String {
        switch self {
        case .text, .textarea: "textformat"
        case .number: "number"
        case .boolean: "checkmark.circle"
        case .date, .datetime: "calendar"
        case .select, .multiSelect: "list.bullet"
        case .reference: "arrowshape.turn.up.right"
        case .email: "envelope"
        case .url: "link"
        }
    }
}

private func settingsColor(_ value: String) -> Color {
    let normalized = value.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    guard normalized.count == 6,
          let number = UInt64(normalized, radix: 16) else {
        return .gray
    }
    return Color(
        red: Double((number >> 16) & 0xff) / 255,
        green: Double((number >> 8) & 0xff) / 255,
        blue: Double(number & 0xff) / 255
    )
}


struct InventoryAISettingsView: View {
    @EnvironmentObject private var state: AppState
    @State private var draft: InventoryAISettingsResponse?
    @State private var errorMessage: String?
    @State private var saving = false
    @State private var notice: String?

    var body: some View {
        Form {
            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                    Button(L10n.text("ui_reload_55786148")) { Task { await load() } }
                }
            }
            if let notice { Text(notice).foregroundStyle(.secondary) }
            if let value = draft {
                Section {
                    TextField(L10n.text("ui_analysis_model_86ad01de"), text: setting(\.analysisModel, fallback: value.inventorySettings.analysisModel))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField(L10n.text("ui_research_model_c37a96b0"), text: setting(\.researchModel, fallback: value.inventorySettings.researchModel))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField(L10n.text("ui_output_language_25cecf38"), text: setting(\.language, fallback: value.inventorySettings.language))
                    Stepper(L10n.text("ui_maximum_photos_0_e0b765cf", value.inventorySettings.maximumImages), value: setting(\.maximumImages, fallback: value.inventorySettings.maximumImages), in: 1...3)
                    Toggle(L10n.text("ui_analyze_photos_by_default_9d1bf9b9"), isOn: setting(\.autoAnalyze, fallback: value.inventorySettings.autoAnalyze))
                    Toggle(L10n.text("ui_research_by_default_47c424dc"), isOn: setting(\.autoResearch, fallback: value.inventorySettings.autoResearch))
                    Toggle(L10n.text("ui_overwrite_existing_text_e3d8f4dd"), isOn: setting(\.overwrite, fallback: value.inventorySettings.overwrite))
                } header: { Text(L10n.text("ui_analysis_and_research_50c89e4e")) } footer: {
                    Text(L10n.text("ui_applies_to_the_app_and_web_app_43f1b858"))
                }
                .disabled(saving || !state.canManageAISettings)
                ForEach(["analysis", "research"], id: \.self) { kind in
                    Section(kind == "analysis" ? L10n.text("ui_analysis_text_template_92adb059") : L10n.text("ui_research_text_template_67674c65")) {
                        Picker(L10n.text("ui_default_template_0a1ea7b0"), selection: Binding(get: { draft?.collection.defaults[kind] ?? "" }, set: { draft?.collection.defaults[kind] = $0 })) {
                            ForEach(value.collection.templates.filter { $0.kind == kind }) { template in
                                Text(template.name).tag(template.id)
                            }
                        }
                        if let id = value.collection.defaults[kind], let index = value.collection.templates.firstIndex(where: { $0.id == id }) {
                            TextEditor(text: Binding(get: { draft?.collection.templates[index].prompt ?? "" }, set: { draft?.collection.templates[index].prompt = $0 }))
                                .frame(minHeight: 240)
                            Text(L10n.text("ui_placeholders_language_allowedtypes_name_description_type_tags_52b70aec"))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }.disabled(saving || !state.canManageAISettings)
                }
                if state.canManageAISettings {
                    Button(saving ? L10n.text("ui_saving_a8060ba6") : L10n.text("ui_save_for_organization_9e34b108")) {
                        Task {
                            guard let draft else { return }
                            saving = true
                            errorMessage = nil
                            do {
                                self.draft = try await state.saveInventoryAISettings(draft)
                                notice = L10n.text("ui_ai_defaults_saved_a2619fe2")
                            } catch { errorMessage = error.localizedDescription }
                            saving = false
                        }
                    }.disabled(saving || !valid(value))
                } else {
                    Text(L10n.text("ui_role_management_permission_is_required_to_make_63e9c3fa")).font(.caption)
                }
            } else if errorMessage == nil {
                ProgressView(L10n.text("ui_loading_ai_defaults_a47a3af1"))
            }
        }
        .navigationTitle(L10n.text("ui_ai_defaults_dec724c7"))
        .task(id: state.organizationContextIdentifier) { draft = nil; await load() }
    }

    private func setting<T>(_ key: WritableKeyPath<InventoryAISettings, T>, fallback: T) -> Binding<T> {
        Binding(get: { draft?.inventorySettings[keyPath: key] ?? fallback }, set: { draft?.inventorySettings[keyPath: key] = $0 })
    }

    private func valid(_ value: InventoryAISettingsResponse) -> Bool {
        let settings = value.inventorySettings
        return [settings.analysisModel, settings.researchModel, settings.language].allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            && settings.analysisModel.utf16.count <= 200 && settings.researchModel.utf16.count <= 200 && settings.language.utf16.count <= 100
            && value.collection.templates.allSatisfy { !$0.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.prompt.utf16.count <= 5_000 }
    }

    private func load() async {
        errorMessage = nil
        do { draft = try await state.refreshInventoryAISettings() }
        catch { errorMessage = error.localizedDescription }
    }
}

import SwiftUI

struct ResourceTranslationsEditorSection: View {
    let resourceID: UUID
    let client: APIClient
    let canTranslateWithAI: Bool

    var body: some View {
        Section(L10n.text("ui_translations_22c9ef6d")) {
            NavigationLink {
                ResourceTranslationsEditorView(
                    resourceID: resourceID,
                    client: client,
                    canTranslateWithAI: canTranslateWithAI
                )
            } label: {
                Label(L10n.text("ui_edit_language_versions_ad528330"), systemImage: "character.book.closed")
            }
            Text(L10n.text("ui_maintain_texts_manually_or_automatically_generate_missing_fe104a1c"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct ResourceTranslationsEditorView: View {
    let resourceID: UUID
    let client: APIClient
    let canTranslateWithAI: Bool

    @State private var overview: ResourceTranslationOverview?
    @State private var loading = true
    @State private var translatingCode: String?
    @State private var savingField: String?
    @State private var errorMessage: String?
    @State private var notice: String?

    var body: some View {
        Form {
            if let overview, !overview.languages.isEmpty {
                Section {
                    LabeledContent(L10n.text("ui_source_language_892b191e"), value: overview.defaultLanguage.label)
                    LabeledContent(L10n.text("ui_content_version_c6ddc0cc"), value: String(overview.contentRevision))
                    if canTranslateWithAI {
                        Button {
                            Task { await translate() }
                        } label: {
                            actionLabel(
                                running: translatingCode == "all",
                                title: L10n.text("ui_translate_missing_and_outdated_texts_800add0b")
                            )
                        }
                        .disabled(translatingCode != nil)
                    }
                }

                ForEach(overview.languages) { language in
                    TranslationLanguageSection(
                        language: language,
                        sourceLanguageLabel: overview.defaultLanguage.label,
                        canTranslateWithAI: canTranslateWithAI,
                        translating: translatingCode == language.code,
                        savingField: savingField,
                        translate: {
                            await translate(
                                languageCode: language.code,
                                force: language.status == "current" || language.status == "failed"
                            )
                        },
                        update: { operation in
                            await update(language: language, operation: operation)
                        }
                    )
                }
            } else if loading {
                Section {
                    HStack {
                        Spacer()
                        ProgressView(L10n.text("ui_loading_translations_e5ca2d88"))
                        Spacer()
                    }
                }
            } else {
                Section {
                    ContentUnavailableView(
                        L10n.text("ui_no_target_languages_1da03820"),
                        systemImage: "character.book.closed",
                        description: Text(L10n.text("ui_no_additional_languages_are_configured_for_this_e78ede92"))
                    )
                }
            }

            if let notice {
                Section {
                    Label(notice, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
            }
        }
        .navigationTitle(L10n.text("ui_translations_22c9ef6d"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading)
                .accessibilityLabel(L10n.text("ui_reload_translations_d4397759"))
            }
        }
        .task { await load() }
        .task(id: activeJobSignature) {
            guard !activeJobSignature.isEmpty else { return }
            while !Task.isCancelled && hasActiveJobs {
                do {
                    try await Task.sleep(for: .seconds(2))
                    guard !Task.isCancelled else { return }
                    await load(quiet: true)
                } catch {
                    return
                }
            }
        }
        .alert(
            L10n.text("ui_could_not_update_translations_4f195802"),
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

    private var activeJobSignature: String {
        overview?.languages.compactMap { language in
            ["pending", "processing"].contains(language.status)
                ? "\(language.code):\(language.revision):\(language.status)"
                : nil
        }.joined(separator: ",") ?? ""
    }

    private var hasActiveJobs: Bool {
        overview?.languages.contains {
            ["pending", "processing"].contains($0.status)
        } ?? false
    }

    @ViewBuilder
    private func actionLabel(running: Bool, title: String) -> some View {
        HStack {
            if running { ProgressView() }
            Label(title, systemImage: running ? "hourglass" : "sparkles")
        }
    }

    @MainActor
    private func load(quiet: Bool = false) async {
        if !quiet { loading = true }
        defer { if !quiet { loading = false } }
        do {
            overview = try await client.getResourceTranslations(id: resourceID)
        } catch {
            if !quiet { errorMessage = error.localizedDescription }
        }
    }

    @MainActor
    private func translate(languageCode: String? = nil, force: Bool = false) async {
        guard translatingCode == nil else { return }
        translatingCode = languageCode ?? "all"
        errorMessage = nil
        notice = nil
        defer { translatingCode = nil }
        do {
            overview = try await client.translateResource(
                id: resourceID,
                languageCodes: languageCode.map { [$0] },
                force: force
            )
            notice = L10n.text("ui_the_translation_has_been_scheduled_5455e3ea")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func update(
        language: ResourceTranslationLanguage,
        operation: ResourceTranslationOperation
    ) async {
        let fieldKey = operation.fieldKey
        let operationKey = "\(language.code):\(fieldKey)"
        guard savingField == nil else { return }
        savingField = operationKey
        errorMessage = nil
        notice = nil
        defer { savingField = nil }
        do {
            overview = try await client.updateResourceTranslation(
                id: resourceID,
                languageCode: language.code,
                expectedRevision: language.revision,
                operations: [operation]
            )
            notice = operation.usesAI
                ? L10n.text("ui_the_ai_translation_has_been_scheduled_27dfd08d")
                : L10n.text("ui_the_translation_has_been_saved_09a81885")
        } catch {
            errorMessage = error.localizedDescription
            await load(quiet: true)
        }
    }
}

private struct TranslationLanguageSection: View {
    let language: ResourceTranslationLanguage
    let sourceLanguageLabel: String
    let canTranslateWithAI: Bool
    let translating: Bool
    let savingField: String?
    let translate: () async -> Void
    let update: (ResourceTranslationOperation) async -> Void

    @State private var expanded = false

    var body: some View {
        Section {
            DisclosureGroup(isExpanded: $expanded) {
                if let lastError = language.lastError, !lastError.isEmpty {
                    Label(lastError, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.vertical, 6)
                }

                ForEach(language.fields) { field in
                    TranslationFieldEditor(
                        field: field,
                        languageCode: language.code,
                        sourceLanguageLabel: sourceLanguageLabel,
                        targetLanguageLabel: language.label,
                        canTranslateWithAI: canTranslateWithAI,
                        busy: savingField == "\(language.code):\(field.fieldKey)",
                        update: update
                    )
                    if field.id != language.fields.last?.id { Divider() }
                }
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(language.label)
                            .font(.headline)
                        Text(language.code.uppercased())
                            .font(.caption2.monospaced().weight(.bold))
                            .foregroundStyle(.secondary)
                        Spacer()
                        TranslationStatusBadge(status: language.status)
                    }
                    Text(L10n.text("ui_0_of_1_fields_up_to_date_37581b72", language.currentCount, language.totalCount))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if canTranslateWithAI {
                Button {
                    Task { await translate() }
                } label: {
                    HStack {
                        if translating { ProgressView() }
                        Label(
                            language.status == "current" || language.status == "failed"
                                ? L10n.text("ui_regenerate_68d85d39")
                                : L10n.text("ui_translate_88f61840"),
                            systemImage: "sparkles"
                        )
                    }
                }
                .disabled(translating)
            }
        }
    }
}

private struct TranslationFieldEditor: View {
    let field: ResourceTranslationField
    let languageCode: String
    let sourceLanguageLabel: String
    let targetLanguageLabel: String
    let canTranslateWithAI: Bool
    let busy: Bool
    let update: (ResourceTranslationOperation) async -> Void

    @State private var draft: String

    init(
        field: ResourceTranslationField,
        languageCode: String,
        sourceLanguageLabel: String,
        targetLanguageLabel: String,
        canTranslateWithAI: Bool,
        busy: Bool,
        update: @escaping (ResourceTranslationOperation) async -> Void
    ) {
        self.field = field
        self.languageCode = languageCode
        self.sourceLanguageLabel = sourceLanguageLabel
        self.targetLanguageLabel = targetLanguageLabel
        self.canTranslateWithAI = canTranslateWithAI
        self.busy = busy
        self.update = update
        _draft = State(initialValue: field.translatedText ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(field.label)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                TranslationStatusBadge(status: field.state)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(sourceLanguageLabel.uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                Text(field.sourceText.isEmpty ? "—" : field.sourceText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(targetLanguageLabel.uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(InventoryTheme.accent)
                TextEditor(text: $draft)
                    .frame(minHeight: 72)
                    .padding(6)
                    .background(.background, in: RoundedRectangle(cornerRadius: 8))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(.quaternary)
                    }
            }

            HStack {
                Button {
                    Task {
                        await update(.set(fieldKey: field.fieldKey, translatedText: draft))
                    }
                } label: {
                    Label(L10n.text("ui_save_f6b2ff39"), systemImage: "checkmark")
                }
                .disabled(busy || draft == (field.translatedText ?? ""))

                if canTranslateWithAI, field.origin == "manual" {
                    Button {
                        Task { await update(.useAI(fieldKey: field.fieldKey)) }
                    } label: {
                        Label(L10n.text("ui_use_ai_e87e8fa0"), systemImage: "sparkles")
                    }
                    .disabled(busy)
                }
            }

            if let suggestion = field.suggestion {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L10n.text("ui_ai_suggestion_ef0c28ac"))
                        .font(.caption.weight(.semibold))
                    Text(suggestion)
                        .font(.caption)
                    Button(L10n.text("ui_accept_suggestion_41ddfc0b")) {
                        Task { await update(.acceptSuggestion(fieldKey: field.fieldKey)) }
                    }
                    .disabled(busy)
                }
                .padding(10)
                .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
            }

            if busy { ProgressView() }
        }
        .padding(.vertical, 8)
        .onChange(of: field.translatedText) { _, value in
            draft = value ?? ""
        }
    }
}

private struct TranslationStatusBadge: View {
    let status: String

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
    }

    private var label: String {
        switch status {
        case "current": L10n.text("ui_current_f4d865ae")
        case "stale": L10n.text("ui_stale_d9075b29")
        case "missing": L10n.text("ui_short_380f98c6")
        case "pending": L10n.text("ui_waiting_cff72948")
        case "processing": L10n.text("ui_in_progress_e94e8adc")
        case "failed": L10n.text("ui_failed_1c47a973")
        case "needs_review": L10n.text("ui_review_a1ca1357")
        default: status
        }
    }

    private var color: Color {
        switch status {
        case "current": .green
        case "failed": .red
        case "pending", "processing": InventoryTheme.accent
        default: .orange
        }
    }
}

private extension ResourceTranslationOperation {
    var fieldKey: String {
        switch self {
        case .set(let fieldKey, _), .acceptSuggestion(let fieldKey), .useAI(let fieldKey):
            fieldKey
        }
    }

    var usesAI: Bool {
        if case .useAI = self { return true }
        return false
    }
}

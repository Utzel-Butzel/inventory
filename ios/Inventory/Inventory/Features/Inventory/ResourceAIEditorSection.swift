import SwiftUI

struct ResourceAIEditorSection: View {
    let resource: InventoryResource
    let client: APIClient
    let canAnalyze: Bool
    let canResearch: Bool
    let canGenerateImages: Bool
    let analysisPrompt: String?
    let coverPrompt: String?
    let selectedImageModelID: String?
    let maximumImageSize: Int
    let onUpdated: (InventoryResource) -> Void

    var body: some View {
        Section(L10n.text("ui_ai_tools_ac717458")) {
            if canAnalyze {
                NavigationLink {
                    ResourceAIAnalyzeView(
                        resource: resource,
                        client: client,
                        prompt: analysisPrompt,
                        onUpdated: onUpdated
                    )
                } label: {
                    Label(L10n.text("ui_update_data_from_images_e3c09e22"), systemImage: "viewfinder")
                }
                .disabled(resource.media.allSatisfy { $0.kind != .image })
            }

            if canResearch {
                NavigationLink {
                    ResourceAIResearchView(
                        resource: resource,
                        client: client,
                        onUpdated: onUpdated
                    )
                } label: {
                    Label(L10n.text("ui_research_item_5ee0db8a"), systemImage: "sparkles")
                }
            }

            if canGenerateImages {
                NavigationLink {
                    ResourceAICoverView(
                        resource: resource,
                        client: client,
                        defaultPrompt: coverPrompt,
                        selectedImageModelID: selectedImageModelID,
                        maximumImageSize: maximumImageSize,
                        onUpdated: onUpdated
                    )
                } label: {
                    Label(L10n.text("ui_generate_new_cover_image_d3aa0a0c"), systemImage: "photo.badge.plus")
                }
                .disabled(resource.media.allSatisfy { $0.kind != .image })
            }

            if canResearch || canGenerateImages {
                NavigationLink {
                    ResourceAIImageAcquisitionView(
                        resource: resource,
                        client: client,
                        canSearch: canResearch,
                        canGenerate: canGenerateImages,
                        selectedImageModelID: selectedImageModelID,
                        maximumImageSize: maximumImageSize,
                        onUpdated: onUpdated
                    )
                } label: {
                    Label(L10n.text("ui_find_or_generate_image_94050a3c"), systemImage: "globe.desk")
                }
            }

            Text(L10n.text("ui_ai_actions_immediately_affect_saved_data_unsaved_2f96aa94"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct ResourceAIAnalyzeView: View {
    @Environment(\.dismiss) private var dismiss
    let resource: InventoryResource
    let client: APIClient
    let prompt: String?
    let onUpdated: (InventoryResource) -> Void

    @State private var overwrite = true
    @State private var defaultsLoaded = false
    @State private var running = false
    @State private var errorMessage: String?
    @State private var operationID = UUID()

    var body: some View {
        Form {
            Section {
                Label(
                    L10n.text("ui_saved_images_are_analyzed_to_derive_inventory_08581f5c"),
                    systemImage: "photo.on.rectangle"
                )
                Toggle(L10n.text("ui_overwrite_existing_fields_539c4b8e"), isOn: $overwrite).disabled(!defaultsLoaded)
            } footer: {
                Text(
                    overwrite
                        ? L10n.text("ui_name_description_type_and_tags_may_be_6380333d")
                        : L10n.text("ui_only_previously_empty_details_are_filled_in_2f0b3ccb")
                )
            }

            actionSection(title: L10n.text("ui_start_image_analysis_77335843")) { run() }.disabled(!defaultsLoaded)
        }
        .task {
            do {
                overwrite = try await client.inventoryAISettings().inventorySettings.overwrite
                defaultsLoaded = true
            } catch { errorMessage = error.localizedDescription }
        }
        .navigationTitle(L10n.text("ui_image_analysis_5d6d896a"))
        .navigationBarTitleDisplayMode(.inline)
        .resourceAIErrorAlert($errorMessage)
    }

    @MainActor
    private func run() {
        guard !running else { return }
        running = true
        Task {
            do {
                let response = try await client.analyzeResource(
                    id: resource.id,
                    overwrite: overwrite,
                    prompt: prompt,
                    idempotencyKey: operationID
                )
                operationID = UUID()
                onUpdated(response.resource)
                dismiss()
            } catch {
                operationID = ObjectCaptureAIIdempotencyPolicy.nextOperationID(
                    current: operationID,
                    after: error
                )
                errorMessage = error.localizedDescription
            }
            running = false
        }
    }

    private func actionSection(title: String, action: @escaping () -> Void) -> some View {
        Section {
            Button(action: action) {
                HStack {
                    if running { ProgressView() }
                    Text(running ? L10n.text("ui_analyzing_f4e8476a") : title)
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(running)
        }
    }
}

private struct ResourceAIResearchView: View {
    @Environment(\.dismiss) private var dismiss
    let resource: InventoryResource
    let client: APIClient
    let onUpdated: (InventoryResource) -> Void

    @State private var running = false
    @State private var errorMessage: String?
    @State private var operationID = UUID()

    var body: some View {
        Form {
            Section {
                Label(L10n.text("ui_saved_details_9929ca67"), systemImage: "doc.text.magnifyingglass")
                Label(L10n.text("ui_existing_images_7a023e7c"), systemImage: "photo.stack")
                Label(L10n.text("ui_web_research_b94bd0bc"), systemImage: "globe")
            } footer: {
                Text(L10n.text("ui_existing_details_are_preserved_relevant_missing_information_b5df3af8"))
            }

            Section {
                Button { run() } label: {
                    HStack {
                        if running { ProgressView() }
                        Text(running ? L10n.text("ui_researching_0dd7122c") : L10n.text("ui_start_research_94ca05df"))
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(running)
            }
        }
        .navigationTitle(L10n.text("ui_research_a12b73cf"))
        .navigationBarTitleDisplayMode(.inline)
        .resourceAIErrorAlert($errorMessage)
    }

    @MainActor
    private func run() {
        guard !running else { return }
        running = true
        Task {
            do {
                let updated = try await client.researchResource(
                    id: resource.id,
                    idempotencyKey: operationID
                )
                operationID = UUID()
                onUpdated(updated)
                dismiss()
            } catch {
                operationID = ObjectCaptureAIIdempotencyPolicy.nextOperationID(
                    current: operationID,
                    after: error
                )
                errorMessage = error.localizedDescription
            }
            running = false
        }
    }
}

private struct ResourceAICoverView: View {
    @Environment(\.dismiss) private var dismiss
    let resource: InventoryResource
    let client: APIClient
    let selectedImageModelID: String?
    let maximumImageSize: Int
    let onUpdated: (InventoryResource) -> Void

    @State private var sourceMediaID: UUID?
    @State private var prompt: String
    @State private var transparentBackground = false
    @State private var transparencyMethod: CoverTransparencyMethod = .differenceMatting
    @State private var running = false
    @State private var errorMessage: String?
    @State private var operationID = UUID()

    init(
        resource: InventoryResource,
        client: APIClient,
        defaultPrompt: String?,
        selectedImageModelID: String?,
        maximumImageSize: Int,
        onUpdated: @escaping (InventoryResource) -> Void
    ) {
        self.resource = resource
        self.client = client
        self.selectedImageModelID = selectedImageModelID
        self.maximumImageSize = maximumImageSize
        self.onUpdated = onUpdated
        let images = resource.media.filter { $0.kind == .image }
        _sourceMediaID = State(initialValue: images.first(where: { $0.source != .ai })?.id ?? images.first?.id)
        _prompt = State(initialValue: defaultPrompt ?? "")
    }

    var body: some View {
        Form {
            Section(L10n.text("ui_reference_image_61a5f093")) {
                Picker(L10n.text("ui_image_375e8403"), selection: $sourceMediaID) {
                    ForEach(resource.media.filter { $0.kind == .image }) { item in
                        Text(item.name).tag(Optional(item.id))
                    }
                }
            }

            Section(L10n.text("ui_instruction_e1812557")) {
                TextEditor(text: $prompt)
                    .frame(minHeight: 120)
            }

            Section(L10n.text("ui_display_1da7a3b4")) {
                Toggle(L10n.text("ui_transparent_background_974a655a"), isOn: $transparentBackground)
                if transparentBackground {
                    Picker(L10n.text("ui_background_removal_222429dd"), selection: $transparencyMethod) {
                        Text(L10n.text("ui_difference_matting_cff0d386")).tag(CoverTransparencyMethod.differenceMatting)
                        Text(L10n.text("ui_green_screen_2e2d5d67")).tag(CoverTransparencyMethod.greenscreen)
                    }
                }
            }

            Section {
                Button { run() } label: {
                    HStack {
                        if running { ProgressView() }
                        Text(running ? L10n.text("ui_generating_cover_image_7e702cda") : L10n.text("ui_generate_cover_image_22a88051"))
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(running || sourceMediaID == nil)
            }
        }
        .navigationTitle(L10n.text("ui_cover_d9f5152c"))
        .navigationBarTitleDisplayMode(.inline)
        .resourceAIErrorAlert($errorMessage)
    }

    @MainActor
    private func run() {
        guard !running else { return }
        running = true
        Task {
            do {
                let response = try await client.generateCover(
                    resourceID: resource.id,
                    sourceMediaID: sourceMediaID,
                    prompt: normalized(prompt),
                    modelID: selectedImageModelID,
                    maximumImageSize: maximumImageSize,
                    transparentBackground: transparentBackground,
                    transparencyMethod: transparentBackground ? transparencyMethod : nil,
                    idempotencyKey: operationID
                )
                operationID = UUID()
                onUpdated(response.resource)
                dismiss()
            } catch {
                operationID = ObjectCaptureAIIdempotencyPolicy.nextOperationID(
                    current: operationID,
                    after: error
                )
                errorMessage = error.localizedDescription
            }
            running = false
        }
    }

    private func normalized(_ value: String) -> String? {
        let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }
}

private struct ResourceAIImageAcquisitionView: View {
    @Environment(\.dismiss) private var dismiss
    let resource: InventoryResource
    let client: APIClient
    let canSearch: Bool
    let canGenerate: Bool
    let selectedImageModelID: String?
    let maximumImageSize: Int
    let onUpdated: (InventoryResource) -> Void

    @State private var mode: ResourceImageAcquisitionMode
    @State private var query: String
    @State private var prompt = ""
    @State private var running = false
    @State private var errorMessage: String?
    @State private var operationID = UUID()

    init(
        resource: InventoryResource,
        client: APIClient,
        canSearch: Bool,
        canGenerate: Bool,
        selectedImageModelID: String?,
        maximumImageSize: Int,
        onUpdated: @escaping (InventoryResource) -> Void
    ) {
        self.resource = resource
        self.client = client
        self.canSearch = canSearch
        self.canGenerate = canGenerate
        self.selectedImageModelID = selectedImageModelID
        self.maximumImageSize = maximumImageSize
        self.onUpdated = onUpdated
        _mode = State(initialValue: canSearch ? .search : .generate)
        _query = State(initialValue: resource.name)
    }

    var body: some View {
        Form {
            if canSearch && canGenerate {
                Section {
                    Picker(L10n.text("ui_image_source_f2d20d83"), selection: $mode) {
                        Text(L10n.text("ui_web_search_dd21378b")).tag(ResourceImageAcquisitionMode.search)
                        Text(L10n.text("ui_ai_generation_9d700943")).tag(ResourceImageAcquisitionMode.generate)
                    }
                    .pickerStyle(.segmented)
                }
            }

            if mode == .search {
                Section(L10n.text("ui_search_term_aaf6d58f")) {
                    TextField(resource.name, text: $query, axis: .vertical)
                        .lineLimit(2 ... 5)
                    Text(L10n.text("ui_please_check_the_license_and_source_of_e29e8bcc"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section(L10n.text("ui_image_description_6983914e")) {
                    TextEditor(text: $prompt)
                        .frame(minHeight: 140)
                    Text(L10n.text("ui_without_a_custom_description_the_server_creates_f5fa3a22"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button { run() } label: {
                    HStack {
                        if running { ProgressView() }
                        Text(running ? L10n.text("ui_obtaining_image_9e0c9bf2") : actionTitle)
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(running)
            }
        }
        .navigationTitle(L10n.text("ui_add_image_c36e0a8d"))
        .navigationBarTitleDisplayMode(.inline)
        .resourceAIErrorAlert($errorMessage)
    }

    private var actionTitle: String {
        mode == .search ? L10n.text("ui_find_image_on_the_web_5af61489") : L10n.text("ui_generate_image_with_ai_5e5a3780")
    }

    @MainActor
    private func run() {
        guard !running else { return }
        running = true
        Task {
            do {
                let updated = try await client.acquireResourceImage(
                    id: resource.id,
                    mode: mode,
                    query: mode == .search ? normalized(query) : nil,
                    prompt: mode == .generate ? normalized(prompt) : nil,
                    modelID: mode == .generate ? selectedImageModelID : nil,
                    maximumImageSize: mode == .generate ? maximumImageSize : nil,
                    idempotencyKey: operationID
                )
                operationID = UUID()
                onUpdated(updated)
                dismiss()
            } catch {
                operationID = ObjectCaptureAIIdempotencyPolicy.nextOperationID(
                    current: operationID,
                    after: error
                )
                errorMessage = error.localizedDescription
            }
            running = false
        }
    }

    private func normalized(_ value: String) -> String? {
        let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }
}

private extension View {
    func resourceAIErrorAlert(_ errorMessage: Binding<String?>) -> some View {
        alert(
            L10n.text("ui_ai_action_failed_0a7ab6e6"),
            isPresented: Binding(
                get: { errorMessage.wrappedValue != nil },
                set: { if !$0 { errorMessage.wrappedValue = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage.wrappedValue = nil }
        } message: {
            Text(errorMessage.wrappedValue ?? L10n.text("ui_unknown_error_617580f0"))
        }
    }
}

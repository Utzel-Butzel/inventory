import SwiftUI

enum ObjectCaptureAIIdempotencyPolicy {
    static func nextOperationID(
        current: UUID,
        after error: Error,
        makeID: () -> UUID = UUID.init
    ) -> UUID {
        guard let apiError = error as? APIClientError,
              let statusCode = apiError.statusCode,
              statusCode != 202 else { return current }
        return makeID()
    }
}

struct ObjectCaptureAISettingsSnapshot: Equatable, Sendable {
    let analysisPrompt: String?
    let transparentCoverPrompt: String?
    let imageModelID: String?
    let maximumImageSize: Int

    init(
        analysisPrompt: String?,
        transparentCoverPrompt: String?,
        imageModelID: String?,
        maximumImageSize: Int
    ) {
        self.analysisPrompt = AIPromptPreferences.validatedPrompt(analysisPrompt)
        self.transparentCoverPrompt = AIPromptPreferences
            .validatedPrompt(transparentCoverPrompt)
        let normalizedModelID = imageModelID?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        self.imageModelID = normalizedModelID.flatMap { $0.isEmpty ? nil : $0 }
        self.maximumImageSize = ImageSizePreferences
            .validatedAIGeneratedPixelSize(maximumImageSize)
    }
}

private struct ValidatedResourceFormValues {
    let slugs: [String]
    let valueCents: Int?
    let currency: String
    let categories: [InventoryResourceCategory]
    let customFields: [String: CustomFieldValue]?
    let gpsLatitude: Double?
    let gpsLongitude: Double?
    let gpsAltitude: Double?
}

struct ResourceFormView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: AppState

    let resource: InventoryResource?
    let prefilledCode: String?
    let objectModel: CapturedObjectModel?
    let resourceAccess: InventoryResourceAccess?
    let onSaved: (InventoryResource) -> Void
    let onDeleted: (() -> Void)?

    @State private var name: String
    @State private var slugs: [String]
    @State private var description: String
    @State private var showDescriptionPreview = true
    @State private var type: InventoryResourceType
    @State private var status: InventoryResourceStatus
    @State private var sku: String
    @State private var barcode: String
    @State private var serialNumber: String
    @State private var quantity: Int
    @State private var location: String
    @State private var tags: String
    @State private var categories: String
    @State private var value: String
    @State private var currency: String
    @State private var priority: Int
    @State private var gpsLatitude: String
    @State private var gpsLongitude: String
    @State private var gpsAltitude: String
    @State private var notes: String
    @State private var inventoryTypes: [InventoryTypeDefinition] = []
    @State private var customFieldDefinitions: [CustomFieldDefinition] = []
    @State private var customFieldValues: [String: CustomFieldValue]
    @State private var customFieldNumberDrafts: [String: String] = [:]
    @State private var metadataErrorMessage: String?
    @State private var customFieldMetadataLoaded = false
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var createOperationID = UUID()
    @State private var modelUploadOperationID = UUID()
    @State private var analysisOperationID = UUID()
    @State private var coverOperationID = UUID()
    @State private var createdResource: InventoryResource?
    @State private var uploadedObjectMedia: MediaUploadResponse?
    @State private var autoAnalyze = true
    @State private var autoResearch = false
    @State private var analysisOverwrite = true
    @State private var aiDefaultsLoaded = false
    @State private var researchCompleted = false
    @State private var researchOperationID = UUID()
    @State private var objectAnalysisCompleted = false
    @State private var objectCoverCompleted = false
    @State private var objectAISettingsSnapshot: ObjectCaptureAISettingsSnapshot?
    @State private var confirmCloseAfterCreation = false
    @State private var serverResource: InventoryResource?
    @State private var currentMedia: [InventoryMedia]
    @State private var pendingMediaUploads: [PendingResourceMedia] = []
    @State private var mediaBusy = false
    @State private var confirmDeletion = false
    @State private var deleting = false

    init(
        resource: InventoryResource? = nil,
        prefilledCode: String? = nil,
        objectModel: CapturedObjectModel? = nil,
        resourceAccess: InventoryResourceAccess? = nil,
        onSaved: @escaping (InventoryResource) -> Void,
        onDeleted: (() -> Void)? = nil
    ) {
        self.resource = resource
        self.prefilledCode = prefilledCode
        self.objectModel = objectModel
        self.resourceAccess = resourceAccess
        self.onSaved = onSaved
        self.onDeleted = onDeleted

        let scanned = prefilledCode?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let useAsBarcode = resource == nil && !scanned.isEmpty && scanned.count <= 180 &&
            ResourceCodeParser.parse(scanned).resourceID == nil
        _name = State(initialValue: resource?.name ?? "")
        _slugs = State(initialValue: resource?.slugs ?? [])
        _description = State(initialValue: resource?.description ?? "")
        _type = State(initialValue: resource?.type ?? .object)
        _status = State(initialValue: resource?.status ?? .available)
        _sku = State(initialValue: resource?.sku ?? "")
        _barcode = State(initialValue: resource?.barcode ?? (useAsBarcode ? scanned : ""))
        _serialNumber = State(initialValue: resource?.serialNumber ?? "")
        _quantity = State(initialValue: resource?.quantity ?? 1)
        _location = State(initialValue: resource?.location ?? "")
        _tags = State(initialValue: resource?.tags.joined(separator: ", ") ?? "")
        _categories = State(
            initialValue: resource?.categories.map(\.name).joined(separator: ", ") ?? ""
        )
        _value = State(
            initialValue: resource?.valueCents.map {
                (Double($0) / 100).formatted(.number.precision(.fractionLength(2)))
            } ?? ""
        )
        _currency = State(initialValue: resource?.currency ?? "EUR")
        _priority = State(initialValue: resource?.priority ?? 3)
        _gpsLatitude = State(initialValue: resource?.gpsLatitude.map { String($0) } ?? "")
        _gpsLongitude = State(initialValue: resource?.gpsLongitude.map { String($0) } ?? "")
        _gpsAltitude = State(initialValue: resource?.gpsAltitude.map { String($0) } ?? "")
        _customFieldValues = State(initialValue: resource?.customFields ?? [:])
        _notes = State(
            initialValue: resource?.notes ?? (
                !scanned.isEmpty && !useAsBarcode
                    ? L10n.text("ui_scanned_code_0_684fe566", scanned)
                    : ""
            )
        )
        _serverResource = State(initialValue: resource)
        _currentMedia = State(initialValue: resource?.media ?? [])
    }

    var body: some View {
        NavigationStack {
            Form {
                if let prefilledCode, !prefilledCode.isEmpty {
                    Section {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(L10n.text("ui_code_applied_0de7e9c5")).font(.subheadline.weight(.semibold))
                                Text(prefilledCode).font(.caption.monospaced()).lineLimit(3)
                            }
                        } icon: {
                            Image(systemName: "qrcode")
                        }
                    }
                }

                if let objectModel {
                    Section(L10n.text("ui_model_3d")) {
                        HStack(spacing: 14) {
                            LocalThumbnail(url: objectModel.articleImageURL, size: 76)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            VStack(alignment: .leading, spacing: 5) {
                                Label("Apple Object Capture", systemImage: "cube.fill")
                                    .font(.subheadline.weight(.semibold))
                                Text(
                                    objectModel.byteCount.formatted(.byteCount(style: .file))
                                        + L10n.text("ui_item_image_dd95a2c5")
                                        + objectModel.articleImageByteCount.formatted(.byteCount(style: .file))
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }

                        if objectModel.shotCount > 0 {
                            LabeledContent(L10n.text("ui_captures_e80dd0e9"), value: "\(objectModel.shotCount)")
                        }

                        Text(objectCaptureProcessingDescription)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let estimate = objectCaptureAICostEstimate {
                            Label(
                                L10n.text("ui_estimated_api_cost_0_f15c8c17", estimate.formattedUSD),
                                systemImage: "dollarsign.circle"
                            )
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                }

                if resource == nil && state.canUseAI {
                    if !aiDefaultsLoaded {
                        Button(L10n.text("ui_reload_ai_defaults_647b46ea")) { Task { await loadAIDefaults() } }
                    }
                    Section(L10n.text("ui_ai_on_creation_2345a631")) {
                        if objectModel != nil && state.canAnalyzeInventory {
                            Toggle(L10n.text("ui_analyze_photos_957b01f7"), isOn: $autoAnalyze)
                            if autoAnalyze { Toggle(L10n.text("ui_overwrite_existing_text_e3d8f4dd"), isOn: $analysisOverwrite) }
                        }
                        if state.canResearchInventory {
                            Toggle(L10n.text("ui_research_after_creating_3b405147"), isOn: $autoResearch)
                            Text(L10n.text("ui_adds_missing_details_from_the_web_and_fb814d36")).font(.caption).foregroundStyle(.secondary)
                        }
                    }.disabled(saving || !aiDefaultsLoaded || createdResource != nil)
                }

                Section(L10n.text("ui_item_72e2f335")) {
                    TextField(L10n.text("ui_name_dcd1d522"), text: $name)
                    Picker(L10n.text("ui_type_1b024183"), selection: $type) {
                        ForEach(selectableTypes, id: \.self) {
                            Text(typeLabel(for: $0)).tag($0)
                        }
                    }
                    Picker(L10n.text("ui_status_920e413c"), selection: $status) {
                        ForEach(InventoryResourceStatus.allCases, id: \.self) {
                            Text($0.localizedName).tag($0)
                        }
                    }
                    TextField(L10n.text("ui_description_e9262f00"), text: $description, axis: .vertical)
                        .lineLimit(3 ... 8)
                    if !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        DisclosureGroup(
                            L10n.text("ui_markdown_preview_2c9f5375"),
                            isExpanded: $showDescriptionPreview
                        ) {
                            MarkdownContentView(
                                markdown: description,
                                client: state.client,
                                media: currentMedia
                            )
                            .padding(.top, 8)
                        }
                    }
                }
                .disabled(createdResource != nil)

                slugEditorSection

                Section(L10n.text("ui_identification_113dc810")) {
                    TextField("SKU", text: $sku)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField(L10n.text("ui_barcode_a401f372"), text: $barcode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField(L10n.text("ui_serial_number_760abc3d"), text: $serialNumber)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField(L10n.text("ui_location_shelf_or_room_5161bf8f"), text: $location)
                    if resource == nil {
                        Stepper(L10n.text("ui_quantity_0_ae0b74e1", quantity), value: $quantity, in: 0 ... 1_000_000)
                    } else {
                        LabeledContent(L10n.text("ui_quantity_1bece813"), value: "\(quantity)")
                    }
                }
                .disabled(createdResource != nil)

                Section(L10n.text("ui_additional_details_66fb159b")) {
                    TextField(L10n.text("ui_tags_separated_by_commas_49ffb625"), text: $tags)
                    TextField(L10n.text("ui_categories_separated_by_commas_ae75ab55"), text: $categories)
                    TextField(L10n.text("ui_notes_7800bd53"), text: $notes, axis: .vertical)
                        .lineLimit(3 ... 10)
                }
                .disabled(createdResource != nil)

                Section(L10n.text("ui_value_and_priority_9c9275fa")) {
                    TextField(L10n.text("ui_value_7e347daa"), text: $value)
                        .keyboardType(.decimalPad)
                    TextField(L10n.text("ui_currency_e_g_eur_452eecb5"), text: $currency)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    Picker(L10n.text("ui_priority_787e02f4"), selection: $priority) {
                        ForEach(1 ... 5, id: \.self) { value in
                            Text("\(value)").tag(value)
                        }
                    }
                }
                .disabled(createdResource != nil)

                Section(L10n.text("ui_gps_position_6c51aa33")) {
                    TextField(L10n.text("ui_latitude_c5049879"), text: $gpsLatitude)
                        .keyboardType(.numbersAndPunctuation)
                    TextField(L10n.text("ui_longitude_4c9aacde"), text: $gpsLongitude)
                        .keyboardType(.numbersAndPunctuation)
                    TextField(L10n.text("ui_altitude_in_meters_5e8e9876"), text: $gpsAltitude)
                        .keyboardType(.numbersAndPunctuation)
                }
                .disabled(createdResource != nil)

                if !applicableCustomFieldDefinitions.isEmpty {
                    CustomFieldEditorSection(
                        definitions: applicableCustomFieldDefinitions,
                        client: state.client,
                        values: $customFieldValues,
                        numberDrafts: $customFieldNumberDrafts
                    )
                    .disabled(createdResource != nil)
                }

                webParitySections

                if let metadataErrorMessage {
                    Section {
                        Label(metadataErrorMessage, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(resource == nil ? L10n.text("ui_new_item_c325efcf") : L10n.text("ui_edit_84e45ee7"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("ui_cancel_f7ff1178")) {
                        if createdResource != nil {
                            confirmCloseAfterCreation = true
                        } else {
                            dismiss()
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? L10n.text("ui_saving_4e85ab63") : L10n.text("ui_save_f6b2ff39")) { save() }
                        .disabled(
                            saving || mediaBusy || deleting || (resource == nil && state.canUseAI && !aiDefaultsLoaded) ||
                                name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        )
                }
            }
            .interactiveDismissDisabled(saving || mediaBusy || deleting || createdResource != nil)
            .task(id: state.organizationContextIdentifier) { await loadMetadata() }
            .task(id: state.organizationContextIdentifier) { await loadAIDefaults() }
            .onDisappear {
                cleanupObjectModel()
                cleanupPendingMedia()
            }
            .confirmationDialog(
                closeAfterPartialCreationTitle,
                isPresented: $confirmCloseAfterCreation,
                titleVisibility: .visible
            ) {
                Button(partialCreationKeepButtonTitle) {
                    if let createdResource {
                        onSaved(createdResource)
                    }
                    dismiss()
                }
                Button(partialCreationRetryButtonTitle) { save() }
                Button(L10n.text("ui_continue_editing_4ec78c78"), role: .cancel) { }
            } message: {
                Text(closeAfterPartialCreationMessage)
            }
            .confirmationDialog(
                L10n.text("ui_really_delete_0_18a752c1", name),
                isPresented: $confirmDeletion,
                titleVisibility: .visible
            ) {
                Button(L10n.text("ui_delete_6c2d3521"), role: .destructive) { deleteResource() }
                Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { }
            } message: {
                Text(L10n.text("ui_the_inventory_item_and_its_media_will_bb2a7eee"))
            }
            .alert(
                L10n.text("ui_saving_failed_6ad2ee31"),
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
    }

    private var slugEditorSection: some View {
        Section {
            if slugs.isEmpty {
                Text(L10n.text("ui_no_readable_short_link_has_been_configured_fcb5aa6f"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(slugs.indices, id: \.self) { index in
                HStack(spacing: 8) {
                    Text("/")
                        .font(.body.monospaced())
                        .foregroundStyle(.secondary)
                    TextField(L10n.text("ui_slug_placeholder"), text: slugBinding(at: index))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    slugMenu(at: index)
                }
            }
            Button {
                slugs.append("")
            } label: {
                Label(L10n.text("ui_add_alias_b55ea7b8"), systemImage: "plus")
            }
            .disabled(slugs.count >= 20)
        } header: {
            Text(L10n.text("ui_aliases_and_links_6a298f95"))
        } footer: {
            Text(L10n.text("ui_the_first_alias_is_the_default_link_b68877ad"))
        }
        .disabled(createdResource != nil)
    }

    private func slugMenu(at index: Int) -> some View {
        Menu {
            Button {
                moveSlug(at: index, by: -1)
            } label: {
                Label(L10n.text("ui_move_up_ed16527a"), systemImage: "arrow.up")
            }
            .disabled(index == 0)

            Button {
                moveSlug(at: index, by: 1)
            } label: {
                Label(L10n.text("ui_move_down_54245735"), systemImage: "arrow.down")
            }
            .disabled(index == slugs.count - 1)

            Divider()

            Button(role: .destructive) {
                slugs.remove(at: index)
            } label: {
                Label(L10n.text("ui_remove_3828375a"), systemImage: "trash")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    @ViewBuilder
    private var webParitySections: some View {
        if let resource {
            ResourceMediaEditorSection(
                resourceID: resource.id,
                client: state.client,
                maximumImagePixelSize: state.maximumUploadImagePixelSize,
                disabled: createdResource != nil || deleting,
                media: $currentMedia,
                pendingUploads: $pendingMediaUploads,
                busy: $mediaBusy,
                reportError: { errorMessage = $0 },
                onUpdated: { serverResource = $0 }
            )
        }

        if let resource = serverResource,
           let client = state.client,
           canUseAIForResource {
            ResourceAIEditorSection(
                resource: resource,
                client: client,
                canAnalyze: state.canAnalyzeInventory,
                canResearch: state.canResearchInventory,
                canGenerateImages: state.canGenerateInventoryImages,
                analysisPrompt: state.analysisPrompt,
                coverPrompt: state.coverPrompt,
                selectedImageModelID: state.selectedImageModelID,
                maximumImageSize: state.maximumAIGeneratedImagePixelSize,
                onUpdated: applyServerResource
            )
        }

        if let resource, let client = state.client {
            ResourceTranslationsEditorSection(
                resourceID: resource.id,
                client: client,
                canTranslateWithAI: state.canTranslateInventory && (resourceAccess?.ai ?? true)
            )
        }

        if resource != nil, canDeleteResource {
            Section {
                Button(L10n.text("ui_delete_inventory_item_970e0545"), role: .destructive) {
                    confirmDeletion = true
                }
                .disabled(saving || mediaBusy || deleting)
            }
        }
    }

    private func loadAIDefaults() async {
        guard resource == nil, state.canUseAI, createdResource == nil else { return }
        do {
            let response = try await state.refreshInventoryAISettings()
            autoAnalyze = state.canAnalyzeInventory && response.inventorySettings.autoAnalyze
            autoResearch = state.canResearchInventory && response.inventorySettings.autoResearch
            analysisOverwrite = response.inventorySettings.overwrite
            aiDefaultsLoaded = true
        } catch { errorMessage = error.localizedDescription }
    }

    private func save() {
        guard resource == nil ? state.canCreateInventory : state.canUpdateInventory else {
            errorMessage = L10n.text("ui_this_account_has_read_only_access_dd3a8caa")
            return
        }
        guard let client = state.client else {
            errorMessage = L10n.text("ui_no_server_connection_configured_4a1c3f55")
            return
        }
        let formValues: ValidatedResourceFormValues
        do {
            formValues = try validatedFormValues()
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        let aiSettings: ObjectCaptureAISettingsSnapshot?
        if objectModel != nil {
            if let objectAISettingsSnapshot {
                aiSettings = objectAISettingsSnapshot
            } else {
                let snapshot = ObjectCaptureAISettingsSnapshot(
                    analysisPrompt: state.analysisPrompt,
                    transparentCoverPrompt: state.transparentCoverPrompt,
                    imageModelID: state.selectedImageModelID,
                    maximumImageSize: state.maximumAIGeneratedImagePixelSize
                )
                objectAISettingsSnapshot = snapshot
                aiSettings = snapshot
            }
        } else {
            aiSettings = nil
        }
        saving = true
        Task {
            do {
                let saved: InventoryResource
                if let resource {
                    saved = try await client.patchResource(
                        id: resource.id,
                        with: ResourcePatchRequest(
                            name: normalized(name),
                            slugs: formValues.slugs,
                            description: normalized(description),
                            type: type,
                            status: status,
                            sku: nullable(sku),
                            barcode: nullable(barcode),
                            location: nullable(location),
                            serialNumber: nullable(serialNumber),
                            valueCents: formValues.valueCents.map(NullablePatch.value) ?? .null,
                            currency: formValues.currency,
                            priority: priority,
                            tags: parsedTags,
                            categories: formValues.categories,
                            customFields: formValues.customFields,
                            gpsLatitude: formValues.gpsLatitude.map(NullablePatch.value) ?? .null,
                            gpsLongitude: formValues.gpsLongitude.map(NullablePatch.value) ?? .null,
                            gpsAltitude: formValues.gpsAltitude.map(NullablePatch.value) ?? .null,
                            notes: normalized(notes)
                        )
                    )
                } else {
                    let created: InventoryResource
                    if let createdResource {
                        created = createdResource
                    } else {
                        created = try await client.createResource(
                            ResourceCreateRequest(
                                name: normalized(name),
                                slugs: formValues.slugs,
                                description: normalized(description),
                                type: type,
                                status: status,
                                sku: optional(sku),
                                barcode: optional(barcode),
                                quantity: quantity,
                                location: optional(location),
                                serialNumber: optional(serialNumber),
                                valueCents: formValues.valueCents,
                                currency: formValues.currency,
                                priority: priority,
                                tags: parsedTags,
                                categories: formValues.categories,
                                customFields: formValues.customFields,
                                gpsLatitude: formValues.gpsLatitude,
                                gpsLongitude: formValues.gpsLongitude,
                                gpsAltitude: formValues.gpsAltitude,
                                notes: normalized(notes)
                            ),
                            idempotencyKey: createOperationID
                        )
                        createdResource = created
                    }
                    if let objectModel {
                        let uploaded: MediaUploadResponse
                        if let uploadedObjectMedia {
                            uploaded = uploadedObjectMedia
                        } else {
                            uploaded = try await client.uploadMedia(
                                resourceID: created.id,
                                files: objectModel.uploadFiles,
                                idempotencyKey: modelUploadOperationID
                            )
                            uploadedObjectMedia = uploaded
                            createdResource = try await client.getResource(id: created.id)
                        }

                        if state.canUseAI {
                            if state.canAnalyzeInventory && autoAnalyze && !objectAnalysisCompleted {
                                do {
                                    let response = try await client.analyzeResource(
                                        id: created.id,
                                        overwrite: analysisOverwrite,
                                        prompt: aiSettings?.analysisPrompt,
                                        idempotencyKey: analysisOperationID
                                    )
                                    objectAnalysisCompleted = true
                                    createdResource = response.resource
                                } catch {
                                    analysisOperationID = ObjectCaptureAIIdempotencyPolicy
                                        .nextOperationID(
                                            current: analysisOperationID,
                                            after: error
                                        )
                                    throw error
                                }
                            }
                            if state.canGenerateInventoryImages && !objectCoverCompleted {
                                guard let articleImage = uploaded.uploaded.first(where: {
                                    $0.kind == .image && $0.source == .upload
                                }) else {
                                    throw APIClientError.invalidResponse
                                }
                                do {
                                    let response = try await client.generateCover(
                                        resourceID: created.id,
                                        sourceMediaID: articleImage.id,
                                        prompt: aiSettings?.transparentCoverPrompt,
                                        modelID: aiSettings?.imageModelID,
                                        maximumImageSize: aiSettings?.maximumImageSize,
                                        transparentBackground: true,
                                        transparencyMethod: .differenceMatting,
                                        idempotencyKey: coverOperationID
                                    )
                                    objectCoverCompleted = true
                                    createdResource = response.resource
                                } catch {
                                    coverOperationID = ObjectCaptureAIIdempotencyPolicy
                                        .nextOperationID(
                                            current: coverOperationID,
                                            after: error
                                        )
                                    throw error
                                }
                            }
                        }
                        saved = try await client.getResource(id: created.id)
                        createdResource = saved
                    } else {
                        saved = created
                    }
                }
                var afterResearch = saved
                if resource == nil && state.canResearchInventory && autoResearch && !researchCompleted {
                    do {
                        afterResearch = try await client.researchResource(id: saved.id, idempotencyKey: researchOperationID)
                        researchCompleted = true
                        createdResource = afterResearch
                    } catch {
                        researchOperationID = ObjectCaptureAIIdempotencyPolicy.nextOperationID(current: researchOperationID, after: error)
                        throw error
                    }
                }
                let fullySaved: InventoryResource
                if let resource, !pendingMediaUploads.isEmpty {
                    _ = try await client.uploadMedia(
                        resourceID: resource.id,
                        files: pendingMediaUploads.map(\.file),
                        idempotencyKey: UUID()
                    )
                    fullySaved = try await client.getResource(id: resource.id)
                } else {
                    fullySaved = afterResearch
                }
                cleanupObjectModel()
                cleanupPendingMedia()
                onSaved(fullySaved)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private var parsedTags: [String] {
        Array(
            Set(
                tags.split(separator: ",")
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
            )
        ).sorted()
    }

    private var parsedCategories: [InventoryResourceCategory] {
        var seen = Set<String>()
        return categories.split(separator: ",").compactMap { candidate in
            let name = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = name.lowercased()
            guard !name.isEmpty, seen.insert(key).inserted else { return nil }
            if let existing = resource?.categories.first(where: {
                $0.name.caseInsensitiveCompare(name) == .orderedSame
            }) {
                return existing
            }
            return InventoryResourceCategory(name: name)
        }
    }

    private var applicableCustomFieldDefinitions: [CustomFieldDefinition] {
        let categoryNames = Set(parsedCategories.map { $0.name.lowercased() })
        return customFieldDefinitions.filter { definition in
            let matchesType = definition.resourceTypes.isEmpty || definition.resourceTypes.contains {
                $0.caseInsensitiveCompare(type.rawValue) == .orderedSame
            }
            let matchesCategory = definition.categories.isEmpty || definition.categories.contains {
                categoryNames.contains($0.lowercased())
            }
            return matchesType && matchesCategory
        }
        .sorted { ($0.position, $0.label) < ($1.position, $1.label) }
    }

    private func loadMetadata() async {
        guard let client = state.client else { return }
        metadataErrorMessage = nil

        do {
            inventoryTypes = try await client.inventoryTypes().types
                .filter { $0.archivedAt == nil }
                .sorted { ($0.position, $0.label) < ($1.position, $1.label) }
        } catch {
            metadataErrorMessage = L10n.text("ui_could_not_load_server_defined_types_25e8d9b1")
        }

        do {
            customFieldDefinitions = try await client.customFieldDefinitions(
                entityType: .inventory
            ).definitions.filter { $0.archivedAt == nil }
            customFieldMetadataLoaded = true
            for definition in customFieldDefinitions where definition.fieldType == .number {
                guard customFieldNumberDrafts[definition.key] == nil,
                      case .number(let number) = customFieldValues[definition.key] else { continue }
                customFieldNumberDrafts[definition.key] = number.formatted(.number.grouping(.never))
            }
        } catch {
            customFieldMetadataLoaded = false
            metadataErrorMessage = [
                metadataErrorMessage,
                L10n.text("ui_custom_fields_could_not_be_loaded_0089a3ba"),
            ].compactMap { $0 }.joined(separator: " ")
        }
    }

    private func validatedFormValues() throws -> ValidatedResourceFormValues {
        let normalizedCurrency = normalized(currency).uppercased()
        guard normalizedCurrency.count == 3,
              normalizedCurrency.allSatisfy({ $0.isLetter }) else {
            throw APIClientError.invalidRequest(L10n.text("ui_the_currency_must_consist_of_three_letters_a4ed7fab"))
        }

        let valueCents: Int?
        if normalized(value).isEmpty {
            valueCents = nil
        } else {
            guard let amount = decimalNumber(value), amount >= 0 else {
                throw APIClientError.invalidRequest(L10n.text("ui_the_value_must_be_a_positive_number_442ee4b6"))
            }
            let cents = (amount * 100).rounded()
            guard cents <= 2_000_000_000 else {
                throw APIClientError.invalidRequest(L10n.text("ui_the_specified_value_is_too_large_25e85c75"))
            }
            valueCents = Int(cents)
        }

        let latitude = try coordinate(gpsLatitude, name: L10n.text("ui_latitude_c5049879"), range: -90 ... 90)
        let longitude = try coordinate(gpsLongitude, name: L10n.text("ui_longitude_4c9aacde"), range: -180 ... 180)
        let altitude = try coordinate(gpsAltitude, name: L10n.text("ui_height_a4d8c347"), range: -12_000 ... 100_000)

        let fields = try validatedCustomFields()
        return ValidatedResourceFormValues(
            slugs: try validatedSlugs(),
            valueCents: valueCents,
            currency: normalizedCurrency,
            categories: parsedCategories,
            customFields: fields,
            gpsLatitude: latitude,
            gpsLongitude: longitude,
            gpsAltitude: altitude
        )
    }

    private func validatedSlugs() throws -> [String] {
        let normalizedSlugs = slugs.map {
            normalized($0).lowercased()
        }.filter { !$0.isEmpty }
        guard normalizedSlugs.count <= 20 else {
            throw APIClientError.invalidRequest(L10n.text("ui_a_maximum_of_20_aliases_is_allowed_c9f16479"))
        }
        guard Set(normalizedSlugs).count == normalizedSlugs.count else {
            throw APIClientError.invalidRequest(L10n.text("ui_each_alias_may_only_appear_once_e775cb3b"))
        }
        let pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
        guard normalizedSlugs.allSatisfy({
            $0.count <= 80 && $0.wholeMatch(of: pattern) != nil
        }) else {
            throw APIClientError.invalidRequest(
                L10n.text("ui_aliases_may_only_contain_lowercase_letters_numbers_a1053d45")
            )
        }
        return normalizedSlugs
    }

    private func slugBinding(at index: Int) -> Binding<String> {
        Binding(
            get: { slugs.indices.contains(index) ? slugs[index] : "" },
            set: { value in
                guard slugs.indices.contains(index) else { return }
                slugs[index] = value.lowercased()
            }
        )
    }

    private func moveSlug(at index: Int, by offset: Int) {
        let destination = index + offset
        guard slugs.indices.contains(index), slugs.indices.contains(destination) else { return }
        slugs.swapAt(index, destination)
    }

    private var canUseAIForResource: Bool {
        state.canUseAI && (resourceAccess?.ai ?? true)
    }

    private var canDeleteResource: Bool {
        state.canDeleteInventory && (resourceAccess?.delete ?? true)
    }

    private func applyServerResource(_ updated: InventoryResource) {
        serverResource = updated
        currentMedia = updated.media
        name = updated.name
        slugs = updated.slugs ?? []
        description = updated.description
        type = updated.type
        status = updated.status
        sku = updated.sku ?? ""
        barcode = updated.barcode ?? ""
        serialNumber = updated.serialNumber ?? ""
        quantity = updated.quantity
        location = updated.location ?? ""
        tags = updated.tags.joined(separator: ", ")
        categories = updated.categories.map(\.name).joined(separator: ", ")
        value = updated.valueCents.map {
            (Double($0) / 100).formatted(.number.precision(.fractionLength(2)))
        } ?? ""
        currency = updated.currency
        priority = updated.priority
        gpsLatitude = updated.gpsLatitude.map { String($0) } ?? ""
        gpsLongitude = updated.gpsLongitude.map { String($0) } ?? ""
        gpsAltitude = updated.gpsAltitude.map { String($0) } ?? ""
        notes = updated.notes
        customFieldValues = updated.customFields ?? [:]
        customFieldNumberDrafts = [:]
        for definition in customFieldDefinitions where definition.fieldType == .number {
            guard case .number(let number) = customFieldValues[definition.key] else { continue }
            customFieldNumberDrafts[definition.key] = number.formatted(.number.grouping(.never))
        }
    }

    private func deleteResource() {
        guard let resource, let client = state.client, canDeleteResource, !deleting else { return }
        deleting = true
        Task {
            do {
                try await client.deleteResource(id: resource.id)
                cleanupPendingMedia()
                onDeleted?()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            deleting = false
        }
    }

    private func cleanupPendingMedia() {
        pendingMediaUploads.forEach { $0.removeLocalFile() }
        pendingMediaUploads = []
    }

    private func validatedCustomFields() throws -> [String: CustomFieldValue]? {
        guard customFieldMetadataLoaded else { return nil }
        var result: [String: CustomFieldValue] = [:]

        for definition in applicableCustomFieldDefinitions {
            if definition.fieldType == .number,
               let draft = customFieldNumberDrafts[definition.key],
               !normalized(draft).isEmpty,
               decimalNumber(draft) == nil {
                throw APIClientError.invalidRequest(
                    L10n.text("ui_0_must_contain_a_number_d3ce94eb", definition.label)
                )
            }

            var fieldValue = customFieldValues[definition.key]
            if definition.fieldType == .boolean, definition.required, fieldValue == nil {
                fieldValue = .boolean(false)
            }
            guard let fieldValue, !isEmpty(fieldValue) else {
                if definition.required {
                    throw APIClientError.invalidRequest(
                        L10n.text("ui_0_is_required_64c4c70e", definition.label)
                    )
                }
                continue
            }

            if case .number(let number) = fieldValue {
                if let minimum = definition.minValue, number < minimum {
                    throw APIClientError.invalidRequest(
                        L10n.text("ui_0_must_be_at_least_1_9317efe4", definition.label, minimum)
                    )
                }
                if let maximum = definition.maxValue, number > maximum {
                    throw APIClientError.invalidRequest(
                        L10n.text("ui_0_must_not_exceed_1_16d63fb7", definition.label, maximum)
                    )
                }
            }
            result[definition.key] = fieldValue
        }
        return result
    }

    private func isEmpty(_ value: CustomFieldValue) -> Bool {
        switch value {
        case .string(let value): normalized(value).isEmpty
        case .strings(let values): values.isEmpty
        case .number, .boolean: false
        }
    }

    private func coordinate(
        _ value: String,
        name: String,
        range: ClosedRange<Double>
    ) throws -> Double? {
        guard !normalized(value).isEmpty else { return nil }
        guard let parsed = decimalNumber(value), range.contains(parsed) else {
            throw APIClientError.invalidRequest(
                L10n.text("ui_0_must_be_between_1_and_2_5f5786ed", name, range.lowerBound, range.upperBound)
            )
        }
        return parsed
    }

    private func decimalNumber(_ value: String) -> Double? {
        Double(normalized(value).replacingOccurrences(of: ",", with: "."))
    }

    private var objectCaptureProcessingDescription: String {
        if state.canUseAI {
            return L10n.text("ui_the_item_image_and_usdz_model_are_5a3ff58c")
        }
        return L10n.text("ui_the_item_image_and_usdz_model_are_372c6d5d")
    }

    private var objectCaptureAICostEstimate: AICostRange? {
        guard state.canUseAI else { return nil }
        let analysis = autoAnalyze ? state.aiCostEstimate(for: "inventoryAnalysis") : nil
        let cover = state.imageGenerationCostEstimate(passes: 2)
        if let analysis, let cover { return analysis.adding(cover) }
        return analysis ?? cover
    }

    private var closeAfterPartialCreationTitle: String {
        uploadedObjectMedia == nil
            ? L10n.text("ui_close_item_without_image_and_3d_model_dbc2199a")
            : L10n.text("ui_automatic_processing_incomplete_17543a9e")
    }

    private var partialCreationKeepButtonTitle: String {
        uploadedObjectMedia == nil
            ? L10n.text("ui_keep_item_anyway_096e3977")
            : L10n.text("ui_keep_with_image_and_3d_model_e4893d51")
    }

    private var partialCreationRetryButtonTitle: String {
        uploadedObjectMedia == nil ? L10n.text("ui_retry_upload_48c7b5f6") : L10n.text("ui_retry_ai_processing_93bbf996")
    }

    private var closeAfterPartialCreationMessage: String {
        if uploadedObjectMedia == nil {
            return L10n.text("ui_the_inventory_item_has_already_been_created_d4b1b91a")
        }
        if state.canUseAI, (!objectAnalysisCompleted || !objectCoverCompleted) {
            return L10n.text("ui_the_item_image_and_3d_model_have_899cc894")
        }
        return L10n.text("ui_the_item_image_and_3d_model_have_4a881ca8")
    }

    private var selectableTypes: [InventoryResourceType] {
        var result = inventoryTypes.map { InventoryResourceType(rawValue: $0.key)! }
        if result.isEmpty { result = InventoryResourceType.allCases }
        if !result.contains(type) { result.insert(type, at: 0) }
        return result
    }

    private func typeLabel(for type: InventoryResourceType) -> String {
        inventoryTypes.first(where: { $0.key == type.rawValue })?.label ?? type.localizedName
    }

    private func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func optional(_ value: String) -> String? {
        let value = normalized(value)
        return value.isEmpty ? nil : value
    }

    private func nullable(_ value: String) -> NullablePatch<String> {
        optional(value).map(NullablePatch.value) ?? .null
    }

    private func cleanupObjectModel() {
        guard let objectModel else { return }
        try? objectModel.removeLocalFiles()
    }
}

extension InventoryResourceStatus {
    var localizedName: String {
        switch self {
        case .available: L10n.text("ui_available_3aa55273")
        case .inUse: L10n.text("ui_in_use_d4800d74")
        case .maintenance: L10n.text("ui_maintenance_854f69bd")
        case .archived: L10n.text("ui_archived_e28232fa")
        }
    }

    var tint: Color {
        switch self {
        case .available: InventoryTheme.success
        case .inUse: InventoryTheme.info
        case .maintenance: InventoryTheme.warning
        case .archived: .secondary
        }
    }
}

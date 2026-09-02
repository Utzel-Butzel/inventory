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
                    ? "Gescannter Code: \(scanned)"
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
                                Text("Code übernommen").font(.subheadline.weight(.semibold))
                                Text(prefilledCode).font(.caption.monospaced()).lineLimit(3)
                            }
                        } icon: {
                            Image(systemName: "qrcode")
                        }
                    }
                }

                if let objectModel {
                    Section("3D-Modell") {
                        HStack(spacing: 14) {
                            LocalThumbnail(url: objectModel.articleImageURL, size: 76)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            VStack(alignment: .leading, spacing: 5) {
                                Label("Apple Object Capture", systemImage: "cube.fill")
                                    .font(.subheadline.weight(.semibold))
                                Text(
                                    objectModel.byteCount.formatted(.byteCount(style: .file))
                                        + " · Artikelbild "
                                        + objectModel.articleImageByteCount.formatted(.byteCount(style: .file))
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }

                        if objectModel.shotCount > 0 {
                            LabeledContent("Aufnahmen", value: "\(objectModel.shotCount)")
                        }

                        Text(objectCaptureProcessingDescription)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let estimate = objectCaptureAICostEstimate {
                            Label(
                                "Geschätzte API-Kosten: \(estimate.formattedUSD)",
                                systemImage: "dollarsign.circle"
                            )
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Gegenstand") {
                    TextField("Name", text: $name)
                    Picker("Typ", selection: $type) {
                        ForEach(selectableTypes, id: \.self) {
                            Text(typeLabel(for: $0)).tag($0)
                        }
                    }
                    Picker("Status", selection: $status) {
                        ForEach(InventoryResourceStatus.allCases, id: \.self) {
                            Text($0.localizedName).tag($0)
                        }
                    }
                    TextField("Beschreibung", text: $description, axis: .vertical)
                        .lineLimit(3 ... 8)
                }
                .disabled(createdResource != nil)

                slugEditorSection

                Section("Identifikation") {
                    TextField("SKU", text: $sku)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Barcode", text: $barcode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Seriennummer", text: $serialNumber)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Ort, Regal oder Raum", text: $location)
                    if resource == nil {
                        Stepper("Menge: \(quantity)", value: $quantity, in: 0 ... 1_000_000)
                    } else {
                        LabeledContent("Menge", value: "\(quantity)")
                    }
                }
                .disabled(createdResource != nil)

                Section("Weitere Angaben") {
                    TextField("Tags, mit Komma getrennt", text: $tags)
                    TextField("Kategorien, mit Komma getrennt", text: $categories)
                    TextField("Notizen", text: $notes, axis: .vertical)
                        .lineLimit(3 ... 10)
                }
                .disabled(createdResource != nil)

                Section("Wert und Priorität") {
                    TextField("Wert", text: $value)
                        .keyboardType(.decimalPad)
                    TextField("Währung (z. B. EUR)", text: $currency)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    Picker("Priorität", selection: $priority) {
                        ForEach(1 ... 5, id: \.self) { value in
                            Text("\(value)").tag(value)
                        }
                    }
                }
                .disabled(createdResource != nil)

                Section("GPS-Position") {
                    TextField("Breitengrad", text: $gpsLatitude)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("Längengrad", text: $gpsLongitude)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("Höhe in Metern", text: $gpsAltitude)
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
            .navigationTitle(resource == nil ? "Neuer Eintrag" : "Bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") {
                        if createdResource != nil {
                            confirmCloseAfterCreation = true
                        } else {
                            dismiss()
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Speichert …" : "Speichern") { save() }
                        .disabled(
                            saving || mediaBusy || deleting ||
                                name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        )
                }
            }
            .interactiveDismissDisabled(saving || mediaBusy || deleting || createdResource != nil)
            .task(id: state.organizationContextIdentifier) { await loadMetadata() }
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
                Button("Weiter bearbeiten", role: .cancel) { }
            } message: {
                Text(closeAfterPartialCreationMessage)
            }
            .confirmationDialog(
                "„\(name)“ wirklich löschen?",
                isPresented: $confirmDeletion,
                titleVisibility: .visible
            ) {
                Button("Löschen", role: .destructive) { deleteResource() }
                Button("Abbrechen", role: .cancel) { }
            } message: {
                Text("Der Inventargegenstand und seine Medien werden dauerhaft entfernt.")
            }
            .alert(
                "Speichern fehlgeschlagen",
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

    private var slugEditorSection: some View {
        Section {
            if slugs.isEmpty {
                Text("Noch kein lesbarer Kurzlink eingerichtet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(slugs.indices, id: \.self) { index in
                HStack(spacing: 8) {
                    Text("/")
                        .font(.body.monospaced())
                        .foregroundStyle(.secondary)
                    TextField("kurzer-name", text: slugBinding(at: index))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    slugMenu(at: index)
                }
            }
            Button {
                slugs.append("")
            } label: {
                Label("Alias hinzufügen", systemImage: "plus")
            }
            .disabled(slugs.count >= 20)
        } header: {
            Text("Aliase und Links")
        } footer: {
            Text("Der erste Alias ist der Standardlink. Erlaubt sind Kleinbuchstaben, Zahlen und einzelne Bindestriche.")
        }
        .disabled(createdResource != nil)
    }

    private func slugMenu(at index: Int) -> some View {
        Menu {
            Button {
                moveSlug(at: index, by: -1)
            } label: {
                Label("Nach oben", systemImage: "arrow.up")
            }
            .disabled(index == 0)

            Button {
                moveSlug(at: index, by: 1)
            } label: {
                Label("Nach unten", systemImage: "arrow.down")
            }
            .disabled(index == slugs.count - 1)

            Divider()

            Button(role: .destructive) {
                slugs.remove(at: index)
            } label: {
                Label("Entfernen", systemImage: "trash")
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
                Button("Inventargegenstand löschen", role: .destructive) {
                    confirmDeletion = true
                }
                .disabled(saving || mediaBusy || deleting)
            }
        }
    }

    private func save() {
        guard resource == nil ? state.canCreateInventory : state.canUpdateInventory else {
            errorMessage = "Dieses Konto hat nur Lesezugriff."
            return
        }
        guard let client = state.client else {
            errorMessage = "Keine Serververbindung eingerichtet."
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
                            if !objectAnalysisCompleted {
                                do {
                                    let response = try await client.analyzeResource(
                                        id: created.id,
                                        overwrite: true,
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
                            if !objectCoverCompleted {
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
                let fullySaved: InventoryResource
                if let resource, !pendingMediaUploads.isEmpty {
                    _ = try await client.uploadMedia(
                        resourceID: resource.id,
                        files: pendingMediaUploads.map(\.file),
                        idempotencyKey: UUID()
                    )
                    fullySaved = try await client.getResource(id: resource.id)
                } else {
                    fullySaved = saved
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
            metadataErrorMessage = "Serverdefinierte Typen konnten nicht geladen werden."
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
                "Benutzerdefinierte Felder konnten nicht geladen werden.",
            ].compactMap { $0 }.joined(separator: " ")
        }
    }

    private func validatedFormValues() throws -> ValidatedResourceFormValues {
        let normalizedCurrency = normalized(currency).uppercased()
        guard normalizedCurrency.count == 3,
              normalizedCurrency.allSatisfy({ $0.isLetter }) else {
            throw APIClientError.invalidRequest("Die Währung muss aus drei Buchstaben bestehen.")
        }

        let valueCents: Int?
        if normalized(value).isEmpty {
            valueCents = nil
        } else {
            guard let amount = decimalNumber(value), amount >= 0 else {
                throw APIClientError.invalidRequest("Der Wert muss eine positive Zahl sein.")
            }
            let cents = (amount * 100).rounded()
            guard cents <= 2_000_000_000 else {
                throw APIClientError.invalidRequest("Der angegebene Wert ist zu groß.")
            }
            valueCents = Int(cents)
        }

        let latitude = try coordinate(gpsLatitude, name: "Breitengrad", range: -90 ... 90)
        let longitude = try coordinate(gpsLongitude, name: "Längengrad", range: -180 ... 180)
        let altitude = try coordinate(gpsAltitude, name: "Höhe", range: -12_000 ... 100_000)

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
            throw APIClientError.invalidRequest("Es sind höchstens 20 Aliase erlaubt.")
        }
        guard Set(normalizedSlugs).count == normalizedSlugs.count else {
            throw APIClientError.invalidRequest("Jeder Alias darf nur einmal vorkommen.")
        }
        let pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
        guard normalizedSlugs.allSatisfy({
            $0.count <= 80 && $0.wholeMatch(of: pattern) != nil
        }) else {
            throw APIClientError.invalidRequest(
                "Aliase dürfen nur Kleinbuchstaben, Zahlen und einzelne Bindestriche enthalten."
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
                    "„\(definition.label)“ muss eine Zahl enthalten."
                )
            }

            var fieldValue = customFieldValues[definition.key]
            if definition.fieldType == .boolean, definition.required, fieldValue == nil {
                fieldValue = .boolean(false)
            }
            guard let fieldValue, !isEmpty(fieldValue) else {
                if definition.required {
                    throw APIClientError.invalidRequest(
                        "„\(definition.label)“ ist ein Pflichtfeld."
                    )
                }
                continue
            }

            if case .number(let number) = fieldValue {
                if let minimum = definition.minValue, number < minimum {
                    throw APIClientError.invalidRequest(
                        "„\(definition.label)“ muss mindestens \(minimum) sein."
                    )
                }
                if let maximum = definition.maxValue, number > maximum {
                    throw APIClientError.invalidRequest(
                        "„\(definition.label)“ darf höchstens \(maximum) sein."
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
                "\(name) muss zwischen \(range.lowerBound) und \(range.upperBound) liegen."
            )
        }
        return parsed
    }

    private func decimalNumber(_ value: String) -> Double? {
        Double(normalized(value).replacingOccurrences(of: ",", with: "."))
    }

    private var objectCaptureProcessingDescription: String {
        if state.canUseAI {
            return "Artikelbild und USDZ-Modell werden hochgeladen. Anschließend folgen automatisch die übliche KI-Erkennung und eine transparente Freistellung."
        }
        return "Artikelbild und USDZ-Modell werden hochgeladen. KI-Erkennung und Freistellung bleiben aus, weil diesem Konto die KI-Berechtigung fehlt."
    }

    private var objectCaptureAICostEstimate: AICostRange? {
        guard state.canUseAI else { return nil }
        let analysis = state.aiCostEstimate(for: "inventoryAnalysis")
        let cover = state.imageGenerationCostEstimate(passes: 2)
        if let analysis, let cover { return analysis.adding(cover) }
        return analysis ?? cover
    }

    private var closeAfterPartialCreationTitle: String {
        uploadedObjectMedia == nil
            ? "Eintrag ohne Artikelbild und 3D-Modell schließen?"
            : "Automatische Verarbeitung unvollständig"
    }

    private var partialCreationKeepButtonTitle: String {
        uploadedObjectMedia == nil
            ? "Eintrag trotzdem behalten"
            : "Mit Artikelbild und 3D-Modell behalten"
    }

    private var partialCreationRetryButtonTitle: String {
        uploadedObjectMedia == nil ? "Upload erneut versuchen" : "KI-Verarbeitung erneut versuchen"
    }

    private var closeAfterPartialCreationMessage: String {
        if uploadedObjectMedia == nil {
            return "Der Inventareintrag wurde bereits angelegt, aber Artikelbild und 3D-Modell wurden noch nicht hochgeladen. Du kannst den Upload erneut versuchen oder den Eintrag ohne diese Medien behalten."
        }
        if state.canUseAI, (!objectAnalysisCompleted || !objectCoverCompleted) {
            return "Artikelbild und 3D-Modell sind bereits gespeichert. Die KI-Erkennung oder transparente Freistellung ist noch nicht vollständig. Du kannst sie erneut versuchen oder den Eintrag mit den vorhandenen Medien behalten."
        }
        return "Artikelbild und 3D-Modell sind bereits gespeichert."
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
        case .available: "Verfügbar"
        case .inUse: "In Benutzung"
        case .maintenance: "Wartung"
        case .archived: "Archiviert"
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

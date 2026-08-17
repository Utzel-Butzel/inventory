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

struct ResourceFormView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: AppState

    let resource: InventoryResource?
    let prefilledCode: String?
    let objectModel: CapturedObjectModel?
    let onSaved: (InventoryResource) -> Void

    @State private var name: String
    @State private var description: String
    @State private var type: InventoryResourceType
    @State private var status: InventoryResourceStatus
    @State private var sku: String
    @State private var serialNumber: String
    @State private var quantity: Int
    @State private var location: String
    @State private var tags: String
    @State private var notes: String
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

    init(
        resource: InventoryResource? = nil,
        prefilledCode: String? = nil,
        objectModel: CapturedObjectModel? = nil,
        onSaved: @escaping (InventoryResource) -> Void
    ) {
        self.resource = resource
        self.prefilledCode = prefilledCode
        self.objectModel = objectModel
        self.onSaved = onSaved

        let scanned = prefilledCode?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let useAsSKU = resource == nil && !scanned.isEmpty && scanned.count <= 80 &&
            ResourceCodeParser.parse(scanned).resourceID == nil
        let useAsSerial = resource == nil && !useAsSKU && !scanned.isEmpty && scanned.count <= 180 &&
            ResourceCodeParser.parse(scanned).resourceID == nil
        _name = State(initialValue: resource?.name ?? "")
        _description = State(initialValue: resource?.description ?? "")
        _type = State(initialValue: resource?.type ?? .object)
        _status = State(initialValue: resource?.status ?? .available)
        _sku = State(initialValue: resource?.sku ?? (useAsSKU ? scanned : ""))
        _serialNumber = State(initialValue: resource?.serialNumber ?? (useAsSerial ? scanned : ""))
        _quantity = State(initialValue: resource?.quantity ?? 1)
        _location = State(initialValue: resource?.location ?? "")
        _tags = State(initialValue: resource?.tags.joined(separator: ", ") ?? "")
        _notes = State(
            initialValue: resource?.notes ?? (
                !scanned.isEmpty && !useAsSKU && !useAsSerial
                    ? "Gescannter Code: \(scanned)"
                    : ""
            )
        )
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
                    }
                }

                Section("Gegenstand") {
                    TextField("Name", text: $name)
                    Picker("Typ", selection: $type) {
                        ForEach(selectableTypes, id: \.self) {
                            Text($0.localizedName).tag($0)
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

                Section("Identifikation") {
                    TextField("SKU", text: $sku)
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
                    TextField("Notizen", text: $notes, axis: .vertical)
                        .lineLimit(3 ... 10)
                }
                .disabled(createdResource != nil)
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
                        .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .interactiveDismissDisabled(saving || createdResource != nil)
            .onDisappear(perform: cleanupObjectModel)
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

    private func save() {
        guard state.canWrite else {
            errorMessage = "Dieses Konto hat nur Lesezugriff."
            return
        }
        guard let client = state.client else {
            errorMessage = "Keine Serververbindung eingerichtet."
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
                            description: normalized(description),
                            type: type,
                            status: status,
                            sku: nullable(sku),
                            location: nullable(location),
                            serialNumber: nullable(serialNumber),
                            tags: parsedTags,
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
                                description: normalized(description),
                                type: type,
                                status: status,
                                sku: optional(sku),
                                quantity: quantity,
                                location: optional(location),
                                serialNumber: optional(serialNumber),
                                tags: parsedTags,
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
                cleanupObjectModel()
                onSaved(saved)
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

    private var objectCaptureProcessingDescription: String {
        if state.canUseAI {
            return "Artikelbild und USDZ-Modell werden hochgeladen. Anschließend folgen automatisch die übliche KI-Erkennung und eine transparente Freistellung."
        }
        return "Artikelbild und USDZ-Modell werden hochgeladen. KI-Erkennung und Freistellung bleiben aus, weil diesem Konto die KI-Berechtigung fehlt."
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
        type.isBuiltIn ? InventoryResourceType.allCases : [type] + InventoryResourceType.allCases
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

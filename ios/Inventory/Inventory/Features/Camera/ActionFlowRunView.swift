import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ActionFlowRunView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss

    let workflow: ScanActionWorkflow
    let code: String
    let codeType: String?

    @State private var chainConfiguration: ActionChainConfiguration?
    @State private var chainReview = ActionChainReview()
    @State private var selectedTargets: [UUID: UUID] = [:]
    @State private var pinnedContext: String?
    @State private var uploadedValues: [String: ScanActionInputValue] = [:]
    @State private var resolution: ScanActionResolution?
    @State private var textInputs: [String: String] = [:]
    @State private var checkboxInputs: [String: Bool] = [:]
    @State private var photoInputs: [String: [PhotosPickerItem]] = [:]
    @State private var fileInputs: [String: [URL]] = [:]
    @State private var uploadKeys: [String: UUID] = [:]
    @State private var executionKey = UUID()
    @State private var loading = true
    @State private var executing = false
    @State private var errorMessage: String?
    @State private var result: ScanActionExecutionResponse?
    @State private var importingFieldKey: String?
    @State private var showFileImporter = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if loading {
                        ProgressView("Aktion wird vorbereitet …")
                            .frame(maxWidth: .infinity, minHeight: 180)
                            .inventoryCard()
                    } else if let chainConfiguration {
                        chainContents(chainConfiguration)
                    } else if let result {
                        successCard(result)
                    } else if let resolution {
                        reviewCard(resolution)
                        inputFields(resolution.fields)
                        executeButton(resolution)
                    } else {
                        failureCard
                    }
                }
                .frame(maxWidth: 680)
                .padding(20)
                .frame(maxWidth: .infinity)
            }
            .background(InventoryTheme.canvas)
            .navigationTitle(workflow.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(chainReview.completed ? "Nächster Scan" : result == nil ? "Abbrechen" : "Fertig") { dismiss() }
                        .disabled(executing || chainReview.confirmationUncertain)
                }
            }
        }
        .interactiveDismissDisabled(executing || chainReview.confirmationUncertain)
        .task { await loadResolution() }
        .onChange(of: state.organizationContextIdentifier) { _, _ in dismiss() }
        .onChange(of: textInputs) { _, _ in chainReview.invalidate() }
        .onChange(of: checkboxInputs) { _, _ in chainReview.invalidate() }
        .onChange(of: selectedTargets) { _, _ in
            chainReview.invalidate(); uploadedValues = [:]; uploadKeys = [:]
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.data, .content],
            allowsMultipleSelection: true
        ) { outcome in
            guard let key = importingFieldKey else { return }
            switch outcome {
            case .success(let urls):
                fileInputs[key] = Array(urls.prefix(12))
                uploadedValues[key] = nil; uploadKeys[key] = nil; chainReview.invalidate()
                errorMessage = nil
            case .failure(let error):
                errorMessage = error.localizedDescription
            }
        }
    }

    @ViewBuilder
    private func chainContents(_ configuration: ActionChainConfiguration) -> some View {
        if let report = chainReview.report {
            ActionChainReportCard(report: report, completed: chainReview.completed)
            if chainReview.completed {
                Button("Nächsten Code scannen") { dismiss() }
                    .buttonStyle(.borderedProminent).tint(InventoryTheme.ink)
                    .frame(minHeight: 48)
            } else {
                VStack(spacing: 12) {
                    Text("Alle Schritte werden gemeinsam ausgeführt. Wenn ein Schritt fehlschlägt, wird nichts gebucht.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    chainError
                    Button {
                        Task { await confirmChain() }
                    } label: {
                        HStack {
                            if executing { ProgressView().tint(.white) }
                            Text(chainReview.confirmationUncertain ? "Bestätigung erneut senden" : "Alle Änderungen bestätigen")
                        }.frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent).tint(InventoryTheme.ink)
                    .disabled(executing || !state.canManageWorkflows)
                    Button("Angaben ändern") { chainReview.invalidate(); errorMessage = nil }
                        .disabled(executing || chainReview.confirmationUncertain)
                    if !state.canManageWorkflows { Label("Du kannst diesen Ablauf nur ansehen.", systemImage: "lock.fill").font(.footnote) }
                }.inventoryCard()
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Label("Code erkannt", systemImage: "qrcode.viewfinder").font(.headline)
                Text(configuration.identifier).font(.body.monospaced()).textSelection(.enabled)
                Text("Wähle die passenden Angaben. Im nächsten Schritt prüfst du alle Änderungen.")
                    .font(.subheadline).foregroundStyle(.secondary)
                DisclosureGroup("\(configuration.actions.filter { $0.enabled != false }.count) Schritte im Ablauf") {
                    ForEach(configuration.actions.filter { $0.enabled != false }) { action in
                        Label(action.label, systemImage: "circle").font(.subheadline)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).inventoryCard()
            targetFields(configuration).disabled(executing)
            inputFields(visibleChainFields(configuration)).disabled(executing)
            VStack(spacing: 12) {
                chainError
                Button {
                    Task { await previewChain(configuration) }
                } label: {
                    HStack {
                        if executing { ProgressView().tint(.white) }
                        Text(executing ? "Ablauf wird geprüft …" : "Alle Aktionen prüfen")
                    }.frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent).tint(InventoryTheme.ink).disabled(executing)
                Text("Dabei wird noch kein Bestand verändert.").font(.footnote).foregroundStyle(.secondary)
            }.inventoryCard()
        }
    }

    @ViewBuilder private var chainError: some View {
        if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline).foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    private func targetFields(_ configuration: ActionChainConfiguration) -> some View {
        ForEach(configuration.targetGroups) { group in
            VStack(alignment: .leading, spacing: 12) {
                if configuration.targetSelectionMode == "all" {
                    Text(group.name).font(.headline)
                } else {
                    Button {
                        if configuration.targetSelectionMode == "radio" {
                            selectedTargets = group.options.first.map { [group.id: $0.id] } ?? [:]
                        } else if selectedTargets[group.id] != nil { selectedTargets[group.id] = nil }
                        else { selectedTargets[group.id] = group.options.first?.id }
                    } label: {
                        Label(group.name, systemImage: selectedTargets[group.id] == nil ? "circle" : "checkmark.circle.fill")
                            .font(.headline).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }.buttonStyle(.plain)
                    .accessibilityAddTraits(selectedTargets[group.id] == nil ? [] : [.isSelected])
                }
                if selectedTargets[group.id] != nil && group.options.count > 1 {
                    Picker("Variante", selection: Binding(
                        get: { selectedTargets[group.id] },
                        set: { selectedTargets[group.id] = $0 }
                    )) {
                        ForEach(group.options) { option in Text(option.name).tag(Optional(option.id)) }
                    }.pickerStyle(.menu).frame(minHeight: 44)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).inventoryCard()
        }
    }

    private func visibleChainFields(_ configuration: ActionChainConfiguration) -> [ScanActionInputField] {
        var values: [String: ActionChainJSON] = [:]
        for field in configuration.inputFields {
            let raw = textInputs[field.key, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
            if field.resolvedType == "checkbox" { values[field.key] = .bool(checkboxInputs[field.key, default: false]) }
            else if field.resolvedType == "number", let number = Double(raw.replacingOccurrences(of: ",", with: ".")), number.isFinite { values[field.key] = .number(number) }
            else if field.resolvedType == "media", !photoInputs[field.key, default: []].isEmpty { values[field.key] = .array([.string("selected")]) }
            else if field.resolvedType == "file", !fileInputs[field.key, default: []].isEmpty { values[field.key] = .array([.string("selected")]) }
            else if !raw.isEmpty { values[field.key] = .string(raw) }
        }
        return configuration.visibleFields(raw: code, inputs: values)
    }

    @MainActor private func previewChain(_ configuration: ActionChainConfiguration) async {
        guard let client = state.client, pinnedContext == state.organizationContextIdentifier else { return }
        let fields = visibleChainFields(configuration)
        errorMessage = nil
        let selected = configuration.targetGroups.compactMap { selectedTargets[$0.id] }
        guard let uploadTarget = selected.first else { errorMessage = "Bitte mindestens ein Produkt auswählen."; return }
        guard validate(fields: fields) else { return }
        for field in fields where field.resolvedType == "number" {
            let raw = textInputs[field.key, default: ""].trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
            if !raw.isEmpty && !(Double(raw)?.isFinite ?? false) { errorMessage = "Bitte bei \(field.label) eine gültige Zahl eingeben."; return }
        }
        executing = true
        defer { executing = false }
        do {
            var inputs = try await encodedInputs(fields: fields, client: client, resourceID: uploadTarget)
            for field in fields where field.resolvedType == "checkbox" { inputs[field.key] = .boolean(checkboxInputs[field.key, default: false]) }
            let request = ActionChainRunRequest(workflowId: configuration.id, code: code, codeType: codeType, selectedResourceIds: selected, inputs: inputs)
            let report = try await client.previewActionChain(request)
            guard pinnedContext == state.organizationContextIdentifier else { return }
            chainReview.reviewed(report, request: request)
        } catch { errorMessage = error.localizedDescription }
    }

    @MainActor private func confirmChain() async {
        guard state.canManageWorkflows, let client = state.client, let request = chainReview.request,
              pinnedContext == state.organizationContextIdentifier, !executing else { return }
        executing = true; errorMessage = nil
        defer { executing = false }
        do {
            let report = try await client.executeActionChain(request, idempotencyKey: chainReview.key)
            guard pinnedContext == state.organizationContextIdentifier else { return }
            chainReview.report = report; chainReview.completed = true; chainReview.confirmationUncertain = false
        } catch {
            if let status = (error as? APIClientError)?.statusCode, (400..<500).contains(status) {
                chainReview.confirmationUncertain = false
                chainReview.invalidate()
                errorMessage = status == 409 ? "Die Angaben oder der Bestand haben sich geändert. Bitte den Ablauf erneut prüfen." : error.localizedDescription
            } else {
                chainReview.confirmationUncertain = true
                errorMessage = "Die Bestätigung ist noch unklar. Bitte erneut senden; dieselbe Buchung wird dabei nicht doppelt ausgeführt."
            }
        }
    }

    private func reviewCard(_ value: ScanActionResolution) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(value.operation.summary, systemImage: "bolt.fill")
                .font(.headline)
            Text(value.resource.name)
                .font(.title3.weight(.semibold))
            Text(value.identifier)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Bestand vorher")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(value.quantityBefore)")
                        .font(.title2.monospacedDigit().bold())
                }
                Spacer()
                Image(systemName: "arrow.right")
                    .foregroundStyle(.secondary)
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text("Bestand danach")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(value.quantityAfter)")
                        .font(.title2.monospacedDigit().bold())
                        .foregroundStyle(value.delta >= 0 ? InventoryTheme.success : .primary)
                }
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .inventoryCard()
    }

    @ViewBuilder
    private func inputFields(_ fields: [ScanActionInputField]) -> some View {
        ForEach(fields) { field in
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 4) {
                    Text(field.label).font(.subheadline.weight(.semibold))
                    if field.required {
                        Text("*").foregroundStyle(.red)
                    }
                }

                switch field.resolvedType {
                case "textarea":
                    TextField(
                        field.placeholder ?? field.label,
                        text: textBinding(for: field.key),
                        axis: .vertical
                    )
                    .lineLimit(3 ... 7)
                    .textFieldStyle(.roundedBorder)
                case "number":
                    TextField(
                        field.placeholder ?? "0",
                        text: textBinding(for: field.key)
                    )
                    .keyboardType(.decimalPad)
                    .textFieldStyle(.roundedBorder)
                case "checkbox":
                    Toggle(
                        field.placeholder ?? "Aktiv",
                        isOn: checkboxBinding(for: field.key)
                    )
                case "select", "radio":
                    if field.resolvedType == "radio" {
                        Picker(
                            field.placeholder ?? "Bitte auswählen",
                            selection: textBinding(for: field.key)
                        ) {
                            Text("Bitte auswählen").tag("")
                            ForEach(field.options ?? []) { option in
                                Text(option.label).tag(option.value)
                            }
                        }
                        .pickerStyle(.inline)
                    } else {
                        Picker(
                            field.placeholder ?? "Bitte auswählen",
                            selection: textBinding(for: field.key)
                        ) {
                            Text("Bitte auswählen").tag("")
                            ForEach(field.options ?? []) { option in
                                Text(option.label).tag(option.value)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                case "media":
                    let selectedPhotoCount = photoInputs[field.key, default: []].count
                    PhotosPicker(
                        selection: photoBinding(for: field.key),
                        maxSelectionCount: 12,
                        matching: .images
                    ) {
                        Label(
                            selectedPhotoCount == 0
                                ? "Fotos auswählen"
                                : "\(selectedPhotoCount) Foto(s) ausgewählt",
                            systemImage: "photo.on.rectangle.angled"
                        )
                        .frame(maxWidth: .infinity, minHeight: 42)
                    }
                    .buttonStyle(.bordered)
                case "file":
                    Button {
                        importingFieldKey = field.key
                        showFileImporter = true
                    } label: {
                        Label(
                            fileInputs[field.key, default: []].isEmpty
                                ? "Dateien auswählen"
                                : "\(fileInputs[field.key, default: []].count) Datei(en) ausgewählt",
                            systemImage: "paperclip"
                        )
                        .frame(maxWidth: .infinity, minHeight: 42)
                    }
                    .buttonStyle(.bordered)
                default:
                    TextField(
                        field.placeholder ?? field.label,
                        text: textBinding(for: field.key)
                    )
                    .textFieldStyle(.roundedBorder)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .inventoryCard()
        }
    }

    private func executeButton(_ value: ScanActionResolution) -> some View {
        VStack(spacing: 10) {
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button {
                Task { await execute(value) }
            } label: {
                Group {
                    if executing {
                        ProgressView().tint(.white)
                    } else {
                        Label("Aktion ausführen", systemImage: "checkmark.circle.fill")
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(InventoryTheme.ink)
            .disabled(executing || !state.canManageWorkflows)
        }
        .inventoryCard()
    }

    private func successCard(_ value: ScanActionExecutionResponse) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 54))
                .foregroundStyle(InventoryTheme.success)
            Text("Aktion ausgeführt")
                .font(.title2.bold())
            Text(value.operation.summary)
                .font(.headline)
            Text("Neuer Bestand: \(value.resource.quantity)")
                .font(.body.monospacedDigit())
                .foregroundStyle(.secondary)
            Button("Fertig") { dismiss() }
                .buttonStyle(.borderedProminent)
                .tint(InventoryTheme.ink)
        }
        .frame(maxWidth: .infinity)
        .inventoryCard()
    }

    private var failureCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle)
                .foregroundStyle(.red)
            Text("Aktion konnte nicht vorbereitet werden")
                .font(.headline)
            Text(errorMessage ?? "Unbekannter Fehler")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Erneut versuchen") {
                Task { await loadResolution() }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .inventoryCard()
    }

    @MainActor
    private func loadResolution() async {
        guard let client = state.client else {
            loading = false
            errorMessage = "Keine Verbindung zum Inventarserver."
            return
        }
        loading = true
        errorMessage = nil
        do {
            pinnedContext = state.organizationContextIdentifier
            if workflow.hasActionChain {
                let configuration = try await client.prepareActionChain(workflowID: workflow.id, code: code, codeType: codeType)
                guard pinnedContext == state.organizationContextIdentifier else { return }
                chainConfiguration = configuration
                selectedTargets = configuration.defaultSelection
                loading = false
                return
            }
            resolution = try await client.resolveScanAction(
                workflowID: workflow.id,
                code: code,
                codeType: codeType
            )
            executionKey = UUID()
        } catch {
            resolution = nil
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    @MainActor
    private func execute(_ value: ScanActionResolution) async {
        guard state.canManageWorkflows, let client = state.client, pinnedContext == state.organizationContextIdentifier else {
            errorMessage = "Du hast keine Berechtigung, diesen Ablauf auszuführen."
            return
        }
        errorMessage = nil
        guard validate(fields: value.fields) else { return }
        executing = true
        do {
            var inputs = try await encodedInputs(fields: value.fields, client: client, resourceID: value.resource.id)
            for field in value.fields where field.resolvedType == "checkbox" {
                inputs[field.key] = .boolean(checkboxInputs[field.key, default: false])
            }
            let request = ScanActionExecuteRequest(
                workflowId: value.workflow.id,
                revision: value.workflow.revision,
                code: code,
                codeType: codeType,
                expectedResourceUpdatedAt: value.expectedResourceUpdatedAt,
                expectedUnitId: value.expectedUnitId,
                expectedUnitUpdatedAt: value.expectedUnitUpdatedAt,
                inputs: inputs
            )
            result = try await client.executeScanAction(request, idempotencyKey: executionKey)
        } catch {
            errorMessage = error.localizedDescription
        }
        executing = false
    }

    private func validate(fields: [ScanActionInputField]) -> Bool {
        for field in fields where field.required {
            let missing: Bool
            switch field.resolvedType {
            case "media": missing = photoInputs[field.key, default: []].isEmpty
            case "file": missing = fileInputs[field.key, default: []].isEmpty
            case "checkbox": missing = false
            default: missing = textInputs[field.key, default: ""]
                .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            if missing {
                errorMessage = "\(field.label) ist erforderlich."
                return false
            }
        }
        return true
    }

    private func encodedInputs(
        fields: [ScanActionInputField],
        client: APIClient,
        resourceID: UUID
    ) async throws -> [String: ScanActionInputValue] {
        var values: [String: ScanActionInputValue] = [:]
        for field in fields {
            switch field.resolvedType {
            case "media":
                if let uploaded = uploadedValues[field.key] { values[field.key] = uploaded; continue }
                let uploads = try await temporaryPhotoUploads(photoInputs[field.key, default: []])
                defer { uploads.forEach { try? FileManager.default.removeItem(at: $0.fileURL) } }
                if !uploads.isEmpty {
                    let response = try await client.uploadMedia(
                        resourceID: resourceID,
                        files: uploads,
                        idempotencyKey: uploadKey(for: field.key)
                    )
                    values[field.key] = .identifiers(
                        response.uploaded.map { $0.id.uuidString.lowercased() }
                    )
                    uploadedValues[field.key] = values[field.key]
                }
            case "file":
                if let uploaded = uploadedValues[field.key] { values[field.key] = uploaded; continue }
                let uploads = try temporaryFileUploads(fileInputs[field.key, default: []])
                defer { uploads.forEach { try? FileManager.default.removeItem(at: $0.fileURL) } }
                if !uploads.isEmpty {
                    let response = try await client.uploadMedia(
                        resourceID: resourceID,
                        files: uploads,
                        idempotencyKey: uploadKey(for: field.key)
                    )
                    values[field.key] = .identifiers(
                        response.uploaded.map { $0.id.uuidString.lowercased() }
                    )
                    uploadedValues[field.key] = values[field.key]
                }
            case "number":
                let raw = textInputs[field.key, default: ""]
                    .replacingOccurrences(of: ",", with: ".")
                if !raw.isEmpty, let number = Double(raw) {
                    values[field.key] = .number(number)
                }
            case "checkbox":
                break
            default:
                let raw = textInputs[field.key, default: ""]
                if !raw.isEmpty { values[field.key] = .text(raw) }
            }
        }
        return values
    }

    private func temporaryPhotoUploads(
        _ items: [PhotosPickerItem]
    ) async throws -> [MediaUploadFile] {
        var files: [MediaUploadFile] = []
        for item in items {
            guard let data = try await item.loadTransferable(type: Data.self) else { throw APIClientError.invalidUpload("Ein Foto konnte nicht geladen werden. Bitte erneut auswählen.") }
            let contentType = item.supportedContentTypes.first ?? .jpeg
            let fileExtension = contentType.preferredFilenameExtension ?? "jpg"
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("action-flow-\(UUID().uuidString).\(fileExtension)")
            try data.write(to: url, options: .atomic)
            files.append(
                MediaUploadFile(
                    fileURL: url,
                    filename: url.lastPathComponent,
                    mimeType: contentType.preferredMIMEType ?? "image/jpeg"
                )
            )
        }
        return files
    }

    private func temporaryFileUploads(_ urls: [URL]) throws -> [MediaUploadFile] {
        try urls.map { source in
            let accessing = source.startAccessingSecurityScopedResource()
            defer { if accessing { source.stopAccessingSecurityScopedResource() } }
            let target = FileManager.default.temporaryDirectory
                .appendingPathComponent("action-flow-\(UUID().uuidString)-\(source.lastPathComponent)")
            try FileManager.default.copyItem(at: source, to: target)
            let type = UTType(filenameExtension: source.pathExtension)
            return MediaUploadFile(
                fileURL: target,
                filename: source.lastPathComponent,
                mimeType: type?.preferredMIMEType ?? "application/octet-stream"
            )
        }
    }

    private func uploadKey(for field: String) -> UUID {
        if let key = uploadKeys[field] { return key }
        let key = UUID()
        uploadKeys[field] = key
        return key
    }

    private func textBinding(for key: String) -> Binding<String> {
        Binding(
            get: { textInputs[key, default: ""] },
            set: { textInputs[key] = $0 }
        )
    }

    private func checkboxBinding(for key: String) -> Binding<Bool> {
        Binding(
            get: { checkboxInputs[key, default: false] },
            set: { checkboxInputs[key] = $0 }
        )
    }

    private func photoBinding(for key: String) -> Binding<[PhotosPickerItem]> {
        Binding(
            get: { photoInputs[key, default: []] },
            set: { photoInputs[key] = $0; uploadedValues[key] = nil; uploadKeys[key] = nil; chainReview.invalidate() }
        )
    }
}

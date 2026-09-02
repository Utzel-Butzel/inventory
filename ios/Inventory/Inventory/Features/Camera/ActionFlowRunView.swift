import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ActionFlowRunView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss

    let workflow: ScanActionWorkflow
    let code: String
    let codeType: String?

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
                .padding(20)
            }
            .background(InventoryTheme.canvas)
            .navigationTitle(workflow.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(result == nil ? "Abbrechen" : "Fertig") { dismiss() }
                }
            }
        }
        .task { await loadResolution() }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.data, .content],
            allowsMultipleSelection: true
        ) { outcome in
            guard let key = importingFieldKey else { return }
            switch outcome {
            case .success(let urls):
                fileInputs[key] = Array(urls.prefix(12))
                errorMessage = nil
            case .failure(let error):
                errorMessage = error.localizedDescription
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
            .disabled(executing)
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
        guard let client = state.client else {
            errorMessage = "Keine Verbindung zum Inventarserver."
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
                }
            case "file":
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
            guard let data = try await item.loadTransferable(type: Data.self) else { continue }
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
            set: { photoInputs[key] = $0 }
        )
    }
}

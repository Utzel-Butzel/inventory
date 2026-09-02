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
        Section("KI-Werkzeuge") {
            if canAnalyze {
                NavigationLink {
                    ResourceAIAnalyzeView(
                        resource: resource,
                        client: client,
                        prompt: analysisPrompt,
                        onUpdated: onUpdated
                    )
                } label: {
                    Label("Daten aus Bildern aktualisieren", systemImage: "viewfinder")
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
                    Label("Gegenstand recherchieren", systemImage: "sparkles")
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
                    Label("Neues Titelbild erzeugen", systemImage: "photo.badge.plus")
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
                    Label("Bild suchen oder erzeugen", systemImage: "globe.desk")
                }
            }

            Text("KI-Aktionen wirken sofort auf die gespeicherten Daten. Noch nicht gespeicherte Formularänderungen werden danach mit dem aktuellen Serverstand abgeglichen.")
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
    @State private var running = false
    @State private var errorMessage: String?
    @State private var operationID = UUID()

    var body: some View {
        Form {
            Section {
                Label(
                    "Gespeicherte Bilder werden analysiert und Inventardaten daraus abgeleitet.",
                    systemImage: "photo.on.rectangle"
                )
                Toggle("Vorhandene Felder überschreiben", isOn: $overwrite)
            } footer: {
                Text(
                    overwrite
                        ? "Name, Beschreibung, Typ und Tags können ersetzt werden."
                        : "Nur bisher leere Angaben werden ergänzt."
                )
            }

            actionSection(title: "Bildanalyse starten") { run() }
        }
        .navigationTitle("Bildanalyse")
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
                    Text(running ? "Analyse läuft …" : title)
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
                Label("Gespeicherte Angaben", systemImage: "doc.text.magnifyingglass")
                Label("Vorhandene Bilder", systemImage: "photo.stack")
                Label("Web-Recherche", systemImage: "globe")
            } footer: {
                Text("Bestehende Angaben bleiben erhalten; passende fehlende Informationen werden ergänzt.")
            }

            Section {
                Button { run() } label: {
                    HStack {
                        if running { ProgressView() }
                        Text(running ? "Recherche läuft …" : "Recherche starten")
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(running)
            }
        }
        .navigationTitle("Recherche")
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
            Section("Referenzbild") {
                Picker("Bild", selection: $sourceMediaID) {
                    ForEach(resource.media.filter { $0.kind == .image }) { item in
                        Text(item.name).tag(Optional(item.id))
                    }
                }
            }

            Section("Anweisung") {
                TextEditor(text: $prompt)
                    .frame(minHeight: 120)
            }

            Section("Darstellung") {
                Toggle("Transparenter Hintergrund", isOn: $transparentBackground)
                if transparentBackground {
                    Picker("Freistellung", selection: $transparencyMethod) {
                        Text("Differenz-Matting").tag(CoverTransparencyMethod.differenceMatting)
                        Text("Greenscreen").tag(CoverTransparencyMethod.greenscreen)
                    }
                }
            }

            Section {
                Button { run() } label: {
                    HStack {
                        if running { ProgressView() }
                        Text(running ? "Titelbild wird erzeugt …" : "Titelbild erzeugen")
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(running || sourceMediaID == nil)
            }
        }
        .navigationTitle("Titelbild")
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
                    Picker("Bildquelle", selection: $mode) {
                        Text("Web-Suche").tag(ResourceImageAcquisitionMode.search)
                        Text("KI-Erzeugung").tag(ResourceImageAcquisitionMode.generate)
                    }
                    .pickerStyle(.segmented)
                }
            }

            if mode == .search {
                Section("Suchbegriff") {
                    TextField(resource.name, text: $query, axis: .vertical)
                        .lineLimit(2 ... 5)
                    Text("Bitte prüfe Lizenz und Herkunft des gefundenen Bildes.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Bildbeschreibung") {
                    TextEditor(text: $prompt)
                        .frame(minHeight: 140)
                    Text("Ohne eigene Beschreibung erstellt der Server ein neutrales Katalogbild aus den Inventardaten.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button { run() } label: {
                    HStack {
                        if running { ProgressView() }
                        Text(running ? "Bild wird beschafft …" : actionTitle)
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(running)
            }
        }
        .navigationTitle("Bild hinzufügen")
        .navigationBarTitleDisplayMode(.inline)
        .resourceAIErrorAlert($errorMessage)
    }

    private var actionTitle: String {
        mode == .search ? "Bild im Web suchen" : "Bild mit KI erzeugen"
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
            "KI-Aktion fehlgeschlagen",
            isPresented: Binding(
                get: { errorMessage.wrappedValue != nil },
                set: { if !$0 { errorMessage.wrappedValue = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage.wrappedValue = nil }
        } message: {
            Text(errorMessage.wrappedValue ?? "Unbekannter Fehler")
        }
    }
}

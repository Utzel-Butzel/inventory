import SwiftUI

struct ResourceFormView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: AppState

    let resource: InventoryResource?
    let prefilledCode: String?
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

    init(
        resource: InventoryResource? = nil,
        prefilledCode: String? = nil,
        onSaved: @escaping (InventoryResource) -> Void
    ) {
        self.resource = resource
        self.prefilledCode = prefilledCode
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

                Section("Gegenstand") {
                    TextField("Name", text: $name)
                    Picker("Typ", selection: $type) {
                        ForEach(InventoryResourceType.allCases, id: \.self) {
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

                Section("Weitere Angaben") {
                    TextField("Tags, mit Komma getrennt", text: $tags)
                    TextField("Notizen", text: $notes, axis: .vertical)
                        .lineLimit(3 ... 10)
                }
            }
            .navigationTitle(resource == nil ? "Neuer Eintrag" : "Bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Speichert …" : "Speichern") { save() }
                        .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .interactiveDismissDisabled(saving)
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
        guard let client = state.client else {
            errorMessage = "Keine Serververbindung eingerichtet."
            return
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
                    saved = try await client.createResource(
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
                        )
                    )
                }
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
}

import SwiftUI

struct BillOfMaterialsView: View {
    @EnvironmentObject private var state: AppState

    let resourceID: UUID
    let canEdit: Bool

    @State private var billOfMaterials: BillOfMaterialsResponse?
    @State private var drafts: [BillOfMaterialsDraft] = []
    @State private var baselineDrafts: [BillOfMaterialsDraft] = []
    @State private var editMode: EditMode = .inactive
    @State private var loading = false
    @State private var saving = false
    @State private var showResourcePicker = false
    @State private var confirmReset = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if loading && billOfMaterials == nil {
                ProgressView("Stückliste wird geladen …")
            } else if let billOfMaterials {
                List {
                    summarySection(billOfMaterials)
                    if let inheritance = billOfMaterials.inheritance {
                        inheritanceSection(inheritance)
                    }
                    componentsSection
                }
                .refreshable {
                    guard !editMode.isEditing else { return }
                    await load()
                }
            } else {
                ContentUnavailableView(
                    "Stückliste nicht verfügbar",
                    systemImage: "list.bullet.rectangle",
                    description: Text(errorMessage ?? "Die Stückliste konnte nicht geladen werden.")
                )
            }
        }
        .environment(\.editMode, $editMode)
        .navigationTitle("Stückliste")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .toolbar { editorToolbar }
        .sheet(isPresented: $showResourcePicker) {
            NavigationStack {
                ResourcePickerView(
                    title: "Komponente auswählen",
                    excludedResourceIDs: excludedResourceIDs
                ) { add($0) }
            }
        }
        .confirmationDialog(
            "Lokale Stücklistenänderungen zurücksetzen?",
            isPresented: $confirmReset,
            titleVisibility: .visible
        ) {
            Button("Auf Primärstückliste zurücksetzen", role: .destructive) {
                Task { await resetOverrides() }
            }
            Button("Abbrechen", role: .cancel) { }
        } message: {
            Text("Danach gelten wieder alle Komponenten der Primärvariante.")
        }
        .alert(
            "Stückliste konnte nicht geändert werden",
            isPresented: Binding(
                get: { errorMessage != nil && billOfMaterials != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
    }

    private func summarySection(_ billOfMaterials: BillOfMaterialsResponse) -> some View {
        Section("Montage") {
            LabeledContent(
                "Baubare Einheiten",
                value: billOfMaterials.buildableQuantity.formatted()
            )
            LabeledContent("Komponenten", value: drafts.count.formatted())
            if drafts.isEmpty {
                Text("Füge Komponenten hinzu, um eine Stückliste für diesen Eintrag zu erstellen.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func inheritanceSection(
        _ inheritance: BillOfMaterialsInheritance
    ) -> some View {
        Section("Vererbung") {
            NavigationLink {
                ResourceDetailLoaderView(resourceID: inheritance.primaryResourceId)
            } label: {
                LabeledContent("Primäre Variante", value: inheritance.primaryName)
            }
            LabeledContent(
                "Lokale Abweichungen",
                value: inheritance.overrideCount.formatted()
            )
            if canEdit && inheritance.overrideCount > 0 && !editMode.isEditing {
                Button("Abweichungen zurücksetzen", role: .destructive) {
                    confirmReset = true
                }
                .disabled(saving)
            }
        }
    }

    @ViewBuilder
    private var componentsSection: some View {
        Section("Komponenten") {
            if editMode.isEditing {
                ForEach($drafts) { $draft in
                    componentEditor($draft)
                }
                .onDelete { drafts.remove(atOffsets: $0) }
                .onMove { drafts.move(fromOffsets: $0, toOffset: $1) }

                Button {
                    showResourcePicker = true
                } label: {
                    Label("Komponente hinzufügen", systemImage: "plus")
                }
                .disabled(drafts.count >= 100 || saving)
            } else {
                ForEach(drafts) { draft in
                    NavigationLink {
                        ResourceDetailLoaderView(resourceID: draft.resourceID)
                    } label: {
                        componentLabel(draft)
                    }
                }
            }
        }
    }

    private func componentEditor(_ draft: Binding<BillOfMaterialsDraft>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(draft.wrappedValue.name)
                        .font(.subheadline.weight(.semibold))
                    if let sku = draft.wrappedValue.sku {
                        Text(sku).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Text("Verfügbar: \(draft.wrappedValue.availableQuantity)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Stepper(
                "Menge pro Einheit: \(draft.wrappedValue.quantityPerAssembly)",
                value: draft.quantityPerAssembly,
                in: 1...2_000_000_000
            )
            TextField("Notiz (optional)", text: draft.note, axis: .vertical)
                .lineLimit(1...4)
        }
        .padding(.vertical, 4)
    }

    private func componentLabel(_ draft: BillOfMaterialsDraft) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "shippingbox")
                .foregroundStyle(InventoryTheme.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(draft.name).font(.subheadline.weight(.semibold))
                Text(componentSubtitle(draft))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !draft.note.isEmpty {
                    Text(draft.note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer()
            Text("×\(draft.quantityPerAssembly)")
                .font(.subheadline.monospacedDigit().weight(.semibold))
        }
    }

    private func componentSubtitle(_ draft: BillOfMaterialsDraft) -> String {
        [
            draft.sku,
            "\(draft.availableQuantity) verfügbar",
            draft.originLabel,
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }

    @ToolbarContentBuilder
    private var editorToolbar: some ToolbarContent {
        if canEdit, billOfMaterials != nil {
            if editMode.isEditing {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { cancelEditing() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Speichert …" : "Speichern") {
                        Task { await save() }
                    }
                    .disabled(saving || drafts == baselineDrafts)
                }
            } else {
                ToolbarItem(placement: .primaryAction) {
                    Button("Bearbeiten") { beginEditing() }
                }
            }
        }
    }

    private var excludedResourceIDs: Set<UUID> {
        Set([resourceID] + drafts.map(\.resourceID))
    }

    private func beginEditing() {
        baselineDrafts = drafts
        editMode = .active
    }

    private func cancelEditing() {
        drafts = baselineDrafts
        editMode = .inactive
    }

    private func add(_ resource: InventoryResource) {
        let slotKey = UUID().uuidString.lowercased()
        drafts.append(
            BillOfMaterialsDraft(
                id: UUID(),
                slotKey: slotKey,
                origin: "local",
                resourceID: resource.id,
                name: resource.name,
                sku: resource.sku,
                quantityPerAssembly: 1,
                note: "",
                availableQuantity: resource.quantity
            )
        )
    }

    private func load() async {
        guard let client = state.client else { return }
        loading = true
        defer { loading = false }
        do {
            apply(try await client.billOfMaterials(resourceID: resourceID))
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func save() async {
        guard let client = state.client, !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let components = drafts.enumerated().map { position, draft in
                BillOfMaterialsComponentRequest(
                    resourceId: draft.resourceID,
                    slotKey: draft.slotKey,
                    quantityPerAssembly: draft.quantityPerAssembly,
                    position: position,
                    note: draft.note.nilIfBlank
                )
            }
            let response = try await client.replaceBillOfMaterials(
                resourceID: resourceID,
                components: components
            )
            apply(response)
            editMode = .inactive
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func resetOverrides() async {
        guard let client = state.client, !saving else { return }
        saving = true
        defer { saving = false }
        do {
            apply(try await client.resetBillOfMaterialsOverrides(resourceID: resourceID))
            editMode = .inactive
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func apply(_ response: BillOfMaterialsResponse) {
        billOfMaterials = response
        drafts = response.components
            .sorted { ($0.position, $0.name) < ($1.position, $1.name) }
            .map(BillOfMaterialsDraft.init)
        baselineDrafts = drafts
    }
}

private struct BillOfMaterialsDraft: Identifiable, Equatable {
    let id: UUID
    let slotKey: String
    let origin: String?
    let resourceID: UUID
    let name: String
    let sku: String?
    var quantityPerAssembly: Int
    var note: String
    let availableQuantity: Int

    init(
        id: UUID,
        slotKey: String,
        origin: String?,
        resourceID: UUID,
        name: String,
        sku: String?,
        quantityPerAssembly: Int,
        note: String,
        availableQuantity: Int
    ) {
        self.id = id
        self.slotKey = slotKey
        self.origin = origin
        self.resourceID = resourceID
        self.name = name
        self.sku = sku
        self.quantityPerAssembly = quantityPerAssembly
        self.note = note
        self.availableQuantity = availableQuantity
    }

    init(_ component: BillOfMaterialsComponent) {
        self.init(
            id: component.id,
            slotKey: component.slotKey,
            origin: component.origin,
            resourceID: component.resourceId,
            name: component.name,
            sku: component.sku,
            quantityPerAssembly: component.quantityPerAssembly,
            note: component.note,
            availableQuantity: component.availableQuantity
        )
    }

    var originLabel: String? {
        switch origin {
        case "inherited": "Geerbt"
        case "override": "Abweichung"
        default: nil
        }
    }
}

private extension String {
    var nilIfBlank: String? {
        let normalized = trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }
}

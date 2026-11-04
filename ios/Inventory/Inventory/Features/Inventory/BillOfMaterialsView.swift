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
                ProgressView(L10n.text("ui_loading_bill_of_materials_0d65fd81"))
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
                    L10n.text("ui_bill_of_materials_unavailable_18a703b5"),
                    systemImage: "list.bullet.rectangle",
                    description: Text(errorMessage ?? L10n.text("ui_unable_to_load_the_bill_of_materials_6755a257"))
                )
            }
        }
        .environment(\.editMode, $editMode)
        .navigationTitle(L10n.text("ui_bill_of_materials_2a456394"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .toolbar { editorToolbar }
        .sheet(isPresented: $showResourcePicker) {
            NavigationStack {
                ResourcePickerView(
                    title: L10n.text("ui_select_component_cf8fc1e1"),
                    excludedResourceIDs: excludedResourceIDs
                ) { add($0) }
            }
        }
        .confirmationDialog(
            L10n.text("ui_reset_local_bill_of_materials_changes_8683af22"),
            isPresented: $confirmReset,
            titleVisibility: .visible
        ) {
            Button(L10n.text("ui_reset_to_primary_bill_of_materials_9bb2ae92"), role: .destructive) {
                Task { await resetOverrides() }
            }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { }
        } message: {
            Text(L10n.text("ui_all_components_from_the_primary_variant_will_1d8e655e"))
        }
        .alert(
            L10n.text("ui_could_not_change_bill_of_materials_353dea5d"),
            isPresented: Binding(
                get: { errorMessage != nil && billOfMaterials != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
        }
    }

    private func summarySection(_ billOfMaterials: BillOfMaterialsResponse) -> some View {
        Section(L10n.text("ui_assembly_121e2522")) {
            LabeledContent(
                L10n.text("ui_buildable_units_c1b5b0fd"),
                value: billOfMaterials.buildableQuantity.formatted()
            )
            LabeledContent(L10n.text("ui_components_8934293b"), value: drafts.count.formatted())
            if drafts.isEmpty {
                Text(L10n.text("ui_add_components_to_create_a_bill_of_d79b8ac6"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func inheritanceSection(
        _ inheritance: BillOfMaterialsInheritance
    ) -> some View {
        Section(L10n.text("ui_inheritance_21a5917e")) {
            NavigationLink {
                ResourceDetailLoaderView(resourceID: inheritance.primaryResourceId)
            } label: {
                LabeledContent(L10n.text("ui_primary_variant_45e0c6c2"), value: inheritance.primaryName)
            }
            LabeledContent(
                L10n.text("ui_local_overrides_ee020cda"),
                value: inheritance.overrideCount.formatted()
            )
            if canEdit && inheritance.overrideCount > 0 && !editMode.isEditing {
                Button(L10n.text("ui_reset_overrides_fff71c61"), role: .destructive) {
                    confirmReset = true
                }
                .disabled(saving)
            }
        }
    }

    @ViewBuilder
    private var componentsSection: some View {
        Section(L10n.text("ui_components_8934293b")) {
            if editMode.isEditing {
                ForEach($drafts) { $draft in
                    componentEditor($draft)
                }
                .onDelete { drafts.remove(atOffsets: $0) }
                .onMove { drafts.move(fromOffsets: $0, toOffset: $1) }

                Button {
                    showResourcePicker = true
                } label: {
                    Label(L10n.text("ui_add_component_16e8ac36"), systemImage: "plus")
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
                Text(L10n.text("ui_available_0_e6a9045f", draft.wrappedValue.availableQuantity))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Stepper(
                L10n.text("ui_quantity_per_unit_0_c5b93356", draft.wrappedValue.quantityPerAssembly),
                value: draft.quantityPerAssembly,
                in: 1...2_000_000_000
            )
            TextField(L10n.text("ui_note_optional_337da4d8"), text: draft.note, axis: .vertical)
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
            L10n.text("ui_0_available_7a17a695", draft.availableQuantity),
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
                    Button(L10n.text("ui_cancel_f7ff1178")) { cancelEditing() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? L10n.text("ui_saving_4e85ab63") : L10n.text("ui_save_f6b2ff39")) {
                        Task { await save() }
                    }
                    .disabled(saving || drafts == baselineDrafts)
                }
            } else {
                ToolbarItem(placement: .primaryAction) {
                    Button(L10n.text("ui_edit_84e45ee7")) { beginEditing() }
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
        case "inherited": L10n.text("ui_inherited_a7d9f59b")
        case "override": L10n.text("ui_override_f172ef3a")
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

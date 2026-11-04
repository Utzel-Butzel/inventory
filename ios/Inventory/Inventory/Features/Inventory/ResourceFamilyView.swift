import SwiftUI

struct ResourceFamilyView: View {
    @EnvironmentObject private var state: AppState

    let resourceID: UUID
    let canEdit: Bool
    let canCreate: Bool

    @State private var family: ResourceFamilyResponse?
    @State private var loading = false
    @State private var busy = false
    @State private var showCreate = false
    @State private var showAttach = false
    @State private var confirmDetach = false
    @State private var errorMessage: String?
    @State private var notice: String?

    var body: some View {
        Group {
            if loading && family == nil {
                ProgressView(L10n.text("ui_loading_variants_994bd02b"))
            } else if let family {
                List {
                    summarySection(family)
                    membersSection(family)
                    actionSection(family)
                }
                .refreshable { await load() }
            } else {
                ContentUnavailableView(
                    L10n.text("ui_variants_unavailable_167a15d9"),
                    systemImage: "square.stack.3d.up.slash",
                    description: Text(errorMessage ?? L10n.text("ui_unable_to_load_the_variant_family_85f0b44f"))
                )
            }
        }
        .navigationTitle(L10n.text("ui_variants_741cba75"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .overlay(alignment: .top) {
            if busy { ProgressView().padding(10) }
        }
        .sheet(isPresented: $showCreate) {
            ResourceFamilyCreateView(resourceID: resourceID) { member in
                notice = L10n.text("ui_0_was_created_as_a_variant_5ec6cdae", member.name)
                Task { await load() }
            }
        }
        .sheet(isPresented: $showAttach) {
            NavigationStack {
                ResourcePickerView(
                    title: L10n.text("ui_link_existing_item_95b3b256"),
                    excludedResourceIDs: familyResourceIDs
                ) { selected in
                    Task { await attach(selected) }
                }
            }
        }
        .confirmationDialog(
            L10n.text("ui_unlink_variant_from_family_11fadd69"),
            isPresented: $confirmDetach,
            titleVisibility: .visible
        ) {
            Button(L10n.text("ui_detach_variant_635d4892"), role: .destructive) {
                Task { await detach() }
            }
            Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { }
        } message: {
            Text(L10n.text("ui_inherited_bill_of_materials_values_are_kept_be0aa751"))
        }
        .alert(
            L10n.text("ui_action_failed_3a20cc65"),
            isPresented: Binding(
                get: { errorMessage != nil && family != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
        }
    }

    private func summarySection(_ family: ResourceFamilyResponse) -> some View {
        Section {
            LabeledContent(L10n.text("ui_total_stock_034f986c"), value: "\(family.summary.totalQuantity)")
            LabeledContent(L10n.text("ui_primary_stock_9eb517e1"), value: "\(family.summary.primaryQuantity)")
            LabeledContent(L10n.text("ui_variants_741cba75"), value: "\(family.summary.variantCount)")
            if let notice {
                Label(notice, systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(InventoryTheme.success)
            }
        } header: {
            Text(family.role == .variant ? L10n.text("ui_variant_family_8eed3e14") : L10n.text("ui_overview_4d2bb368"))
        } footer: {
            if family.role == .variant {
                Text(L10n.text("ui_this_item_inherits_catalog_fields_from_0_58114d41", family.primary.name))
            }
        }
    }

    private func membersSection(_ family: ResourceFamilyResponse) -> some View {
        Section(L10n.text("ui_members_bc1679e6")) {
            memberRow(family.primary, role: L10n.text("ui_primary_e08e82b1"))
            ForEach(family.variants) { member in
                memberRow(member, role: L10n.text("ui_variant_a0f6dc64"))
            }
        }
    }

    @ViewBuilder
    private func memberRow(_ member: ResourceFamilyMember, role: String) -> some View {
        if member.id == resourceID {
            memberLabel(member, role: L10n.text("ui_0_current_ad03bc4f", role))
        } else {
            NavigationLink {
                ResourceDetailLoaderView(resourceID: member.id)
            } label: {
                memberLabel(member, role: role)
            }
        }
    }

    private func memberLabel(_ member: ResourceFamilyMember, role: String) -> some View {
        HStack {
            Image(systemName: member.type.symbolName)
                .foregroundStyle(InventoryTheme.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(member.name).font(.subheadline.weight(.semibold))
                Text([role, member.sku].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(member.quantity)")
                .font(.caption.monospacedDigit().weight(.semibold))
        }
    }

    @ViewBuilder
    private func actionSection(_ family: ResourceFamilyResponse) -> some View {
        if family.role == .variant, canEdit {
            Section {
                Button(L10n.text("ui_unlink_from_variant_family_34962f1a"), role: .destructive) {
                    confirmDetach = true
                }
                .disabled(busy)
            }
        } else if family.role == .primary,
                  family.optionGroupCount == 0,
                  canEdit || canCreate {
            Section(L10n.text("ui_actions_5656f92d")) {
                if canCreate {
                    Button {
                        showCreate = true
                    } label: {
                        Label(L10n.text("ui_create_new_variant_19fc9268"), systemImage: "plus")
                    }
                }
                if canEdit {
                    Button {
                        showAttach = true
                    } label: {
                        Label(L10n.text("ui_link_existing_item_95b3b256"), systemImage: "link")
                    }
                }
            }
        } else if family.optionGroupCount > 0 {
            Section {
                Label(
                    L10n.text("ui_this_family_is_managed_through_option_groups_19ab4d84"),
                    systemImage: "slider.horizontal.3"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }

    private var familyResourceIDs: Set<UUID> {
        guard let family else { return [resourceID] }
        return Set([family.primary.id] + family.variants.map(\.id))
    }

    private func load() async {
        guard let client = state.client else { return }
        loading = true
        defer { loading = false }
        do {
            family = try await client.resourceFamily(resourceID: resourceID)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func attach(_ selected: InventoryResource) async {
        guard let client = state.client, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await client.attachResourceFamilyVariant(
                resourceID: resourceID,
                existingResourceID: selected.id
            )
            notice = L10n.text("ui_0_was_linked_as_a_variant_e0e96c6e", selected.name)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func detach() async {
        guard let client = state.client, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await client.detachResourceFamilyVariant(resourceID: resourceID)
            notice = L10n.text("ui_the_variant_was_unlinked_from_the_family_9d563d54")
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ResourceFamilyCreateView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: AppState

    let resourceID: UUID
    let onCreated: (ResourceFamilyMember) -> Void

    @State private var name = ""
    @State private var sku = ""
    @State private var barcode = ""
    @State private var saving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(L10n.text("ui_variant_a0f6dc64")) {
                    TextField(L10n.text("ui_name_dcd1d522"), text: $name)
                    TextField(L10n.text("ui_sku_optional_2ae37b81"), text: $sku)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField(L10n.text("ui_barcode_optional_0595a10f"), text: $barcode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section {
                    Text(L10n.text("ui_description_type_and_other_catalog_fields_are_20cba8ca"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(L10n.text("ui_new_variant_cbbbd7e7"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("ui_cancel_f7ff1178")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? L10n.text("ui_saving_4e85ab63") : L10n.text("ui_create_d34c0efb")) { save() }
                        .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .alert(
                L10n.text("ui_could_not_create_variant_2f9a2e2f"),
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

    private func save() {
        guard let client = state.client else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                let response = try await client.createResourceFamilyVariant(
                    resourceID: resourceID,
                    request: ResourceFamilyVariantRequest(
                        name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                        sku: sku.nilIfBlank,
                        barcode: barcode.nilIfBlank
                    )
                )
                onCreated(response.variant)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private extension String {
    var nilIfBlank: String? {
        let normalized = trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }
}

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
                ProgressView("Varianten werden geladen …")
            } else if let family {
                List {
                    summarySection(family)
                    membersSection(family)
                    if family.legacyVariantCount > 0 {
                        Section {
                            Label(
                                "Zusätzlich existieren \(family.legacyVariantCount) ältere Varianten.",
                                systemImage: "exclamationmark.triangle"
                            )
                            .font(.caption)
                            .foregroundStyle(.orange)
                        }
                    }
                    actionSection(family)
                }
                .refreshable { await load() }
            } else {
                ContentUnavailableView(
                    "Varianten nicht verfügbar",
                    systemImage: "square.stack.3d.up.slash",
                    description: Text(errorMessage ?? "Die Variantenfamilie konnte nicht geladen werden.")
                )
            }
        }
        .navigationTitle("Varianten")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .overlay(alignment: .top) {
            if busy { ProgressView().padding(10) }
        }
        .sheet(isPresented: $showCreate) {
            ResourceFamilyCreateView(resourceID: resourceID) { member in
                notice = "„\(member.name)“ wurde als Variante angelegt."
                Task { await load() }
            }
        }
        .sheet(isPresented: $showAttach) {
            NavigationStack {
                ResourcePickerView(
                    title: "Bestehenden Eintrag verbinden",
                    excludedResourceIDs: familyResourceIDs
                ) { selected in
                    Task { await attach(selected) }
                }
            }
        }
        .confirmationDialog(
            "Variante von der Familie lösen?",
            isPresented: $confirmDetach,
            titleVisibility: .visible
        ) {
            Button("Variante lösen", role: .destructive) {
                Task { await detach() }
            }
            Button("Abbrechen", role: .cancel) { }
        } message: {
            Text("Geerbte Stücklistenwerte werden als lokale Werte übernommen.")
        }
        .alert(
            "Aktion fehlgeschlagen",
            isPresented: Binding(
                get: { errorMessage != nil && family != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
    }

    private func summarySection(_ family: ResourceFamilyResponse) -> some View {
        Section {
            LabeledContent("Gesamtbestand", value: "\(family.summary.totalQuantity)")
            LabeledContent("Primärbestand", value: "\(family.summary.primaryQuantity)")
            LabeledContent("Varianten", value: "\(family.summary.variantCount)")
            if let notice {
                Label(notice, systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(InventoryTheme.success)
            }
        } header: {
            Text(family.role == .variant ? "Variantenfamilie" : "Übersicht")
        } footer: {
            if family.role == .variant {
                Text("Dieser Eintrag erbt Katalogfelder von „\(family.primary.name)“.")
            }
        }
    }

    private func membersSection(_ family: ResourceFamilyResponse) -> some View {
        Section("Mitglieder") {
            memberRow(family.primary, role: "Primär")
            ForEach(family.variants) { member in
                memberRow(member, role: "Variante")
            }
        }
    }

    @ViewBuilder
    private func memberRow(_ member: ResourceFamilyMember, role: String) -> some View {
        if member.id == resourceID {
            memberLabel(member, role: "\(role) · Aktuell")
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
                Button("Von Variantenfamilie lösen", role: .destructive) {
                    confirmDetach = true
                }
                .disabled(busy)
            }
        } else if family.role == .primary,
                  family.optionGroupCount == 0,
                  canEdit || canCreate {
            Section("Aktionen") {
                if canCreate {
                    Button {
                        showCreate = true
                    } label: {
                        Label("Neue Variante anlegen", systemImage: "plus")
                    }
                }
                if canEdit {
                    Button {
                        showAttach = true
                    } label: {
                        Label("Bestehenden Eintrag verbinden", systemImage: "link")
                    }
                }
            }
        } else if family.optionGroupCount > 0 {
            Section {
                Label(
                    "Diese Familie wird durch Optionsgruppen verwaltet.",
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
            notice = "„\(selected.name)“ wurde als Variante verbunden."
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
            notice = "Die Variante wurde von der Familie gelöst."
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
                Section("Variante") {
                    TextField("Name", text: $name)
                    TextField("SKU (optional)", text: $sku)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Barcode (optional)", text: $barcode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section {
                    Text("Beschreibung, Typ und weitere Katalogfelder werden vom Primäreintrag übernommen.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Neue Variante")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Speichert …" : "Anlegen") { save() }
                        .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .alert(
                "Variante konnte nicht angelegt werden",
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

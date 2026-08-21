import SwiftUI

struct ResourceRelationsView: View {
    @EnvironmentObject private var state: AppState

    let resourceID: UUID
    let canEdit: Bool

    @State private var relations: [ResourceRelation] = []
    @State private var relationTypes: [RelationTypeDefinition] = []
    @State private var loading = false
    @State private var deletingID: UUID?
    @State private var showCreate = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if loading && relations.isEmpty {
                ProgressView("Beziehungen werden geladen …")
                    .frame(maxWidth: .infinity)
            } else if relations.isEmpty {
                ContentUnavailableView(
                    "Keine Beziehungen",
                    systemImage: "link",
                    description: Text("Dieser Eintrag ist noch mit keinem anderen Eintrag verbunden.")
                )
            } else {
                ForEach(relations) { relation in
                    relationRow(relation)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if canRemove(relation) {
                                Button(role: .destructive) {
                                    Task { await remove(relation) }
                                } label: {
                                    Label("Entfernen", systemImage: "trash")
                                }
                                .disabled(deletingID != nil)
                            }
                        }
                }
            }
        }
        .navigationTitle("Beziehungen")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canEdit, !relationTypes.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showCreate = true
                    } label: {
                        Label("Beziehung hinzufügen", systemImage: "plus")
                    }
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showCreate) {
            ResourceRelationCreateView(
                resourceID: resourceID,
                relationTypes: relationTypes
            ) {
                Task { await load() }
            }
        }
        .alert(
            "Beziehung konnte nicht geändert werden",
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

    @ViewBuilder
    private func relationRow(_ relation: ResourceRelation) -> some View {
        let outgoing = relation.sourceResourceId == resourceID
        let related = outgoing ? relation.target : relation.source
        let relatedID = outgoing ? relation.targetResourceId : relation.sourceResourceId
        NavigationLink {
            ResourceDetailLoaderView(resourceID: relatedID)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: relation.origin == "spatial" ? "mappin.and.ellipse" : "link")
                    .foregroundStyle(
                        relation.origin == "spatial" ? InventoryTheme.accent : .secondary
                    )
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 3) {
                    Text(related?.name ?? relatedID.uuidString)
                        .font(.subheadline.weight(.semibold))
                    Text(relationLabel(relation, outgoing: outgoing))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if relation.origin == "spatial" {
                    Text("Automatisch")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(InventoryTheme.accent)
                }
            }
        }
    }

    private func relationLabel(_ relation: ResourceRelation, outgoing: Bool) -> String {
        let type = relation.relationType
            ?? relationTypes.first(where: { $0.key == relation.relationTypeKey })
        return outgoing
            ? (type?.label ?? relation.relationTypeKey)
            : (type?.inverseLabel ?? relation.relationTypeKey)
    }

    private func canRemove(_ relation: ResourceRelation) -> Bool {
        canEdit && relation.origin == "manual" && relation.relationTypeKey != "variant_of"
    }

    private func load() async {
        guard let client = state.client else { return }
        loading = true
        defer { loading = false }
        do {
            async let loadedRelations = client.resourceRelations(resourceID: resourceID)
            async let loadedTypes = client.relationTypes()
            let (relationResponse, typeResponse) = try await (loadedRelations, loadedTypes)
            relations = relationResponse.relations
            relationTypes = typeResponse.relationTypes
                .filter { $0.archivedAt == nil && $0.allowManual && $0.key != "variant_of" }
                .sorted { ($0.position, $0.label) < ($1.position, $1.label) }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func remove(_ relation: ResourceRelation) async {
        guard let client = state.client, deletingID == nil else { return }
        deletingID = relation.id
        defer { deletingID = nil }
        do {
            try await client.deleteResourceRelation(
                relationID: relation.id,
                resourceID: resourceID
            )
            withAnimation { relations.removeAll { $0.id == relation.id } }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum ResourceRelationDirection: String, CaseIterable, Identifiable {
    case outgoing
    case incoming

    var id: Self { self }
    var title: String { self == .outgoing ? "Ausgehend" : "Eingehend" }
}

private struct ResourceRelationCreateView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: AppState

    let resourceID: UUID
    let relationTypes: [RelationTypeDefinition]
    let onCreated: () -> Void

    @State private var relationTypeKey: String
    @State private var direction: ResourceRelationDirection = .outgoing
    @State private var selectedResource: InventoryResource?
    @State private var showResourcePicker = false
    @State private var saving = false
    @State private var errorMessage: String?

    init(
        resourceID: UUID,
        relationTypes: [RelationTypeDefinition],
        onCreated: @escaping () -> Void
    ) {
        self.resourceID = resourceID
        self.relationTypes = relationTypes
        self.onCreated = onCreated
        _relationTypeKey = State(initialValue: relationTypes.first?.key ?? "related")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Beziehung") {
                    Picker("Typ", selection: $relationTypeKey) {
                        ForEach(relationTypes) { type in
                            Text(type.label).tag(type.key)
                        }
                    }
                    Picker("Richtung", selection: $direction) {
                        ForEach(ResourceRelationDirection.allCases) { direction in
                            Text(direction.title).tag(direction)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Anderer Eintrag") {
                    Button {
                        showResourcePicker = true
                    } label: {
                        HStack {
                            Text(selectedResource?.name ?? "Eintrag auswählen")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let type = relationTypes.first(where: { $0.key == relationTypeKey }),
                   !type.description.isEmpty {
                    Section {
                        Text(type.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Beziehung hinzufügen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Speichert …" : "Hinzufügen") { save() }
                        .disabled(saving || selectedResource == nil || relationTypeKey.isEmpty)
                }
            }
            .sheet(isPresented: $showResourcePicker) {
                NavigationStack {
                    ResourcePickerView(
                        title: "Eintrag auswählen",
                        excludedResourceIDs: [resourceID]
                    ) { selectedResource = $0 }
                }
            }
            .alert(
                "Beziehung konnte nicht angelegt werden",
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
        guard let selectedResource, let client = state.client else { return }
        let sourceID = direction == .outgoing ? resourceID : selectedResource.id
        let targetID = direction == .outgoing ? selectedResource.id : resourceID
        saving = true
        Task {
            defer { saving = false }
            do {
                _ = try await client.createResourceRelation(
                    resourceID: resourceID,
                    request: ResourceRelationCreateRequest(
                        sourceResourceId: sourceID,
                        targetResourceId: targetID,
                        relationTypeKey: relationTypeKey
                    )
                )
                onCreated()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

import SwiftUI

struct InventoryListView: View {
    @EnvironmentObject private var state: AppState
    @Binding private var query: String
    private let onCapture: () -> Void
    private let onScan: () -> Void
    @State private var resources: [InventoryResource] = []
    @State private var typeFilter: InventoryResourceType?
    @State private var statusFilter: InventoryResourceStatus?
    @State private var favoritesOnly = false
    @State private var page = 1
    @State private var pages = 1
    @State private var total = 0
    @State private var loading = false
    @State private var loadingMore = false
    @State private var errorMessage: String?
    @State private var creationSheet: InventoryCreationSheet?
    @State private var showObjectCapture = false
    @State private var capturedObjectPendingForm: CapturedObjectModel?
    @State private var openManualFormAfterCapture = false
    @State private var resourcePendingDeletion: InventoryResource?
    @State private var deletingResourceID: UUID?
    @State private var deletionErrorMessage: String?
    @State private var updatingFavoriteIDs: Set<UUID> = []
    @State private var favoriteErrorMessage: String?

    init(
        query: Binding<String>,
        onCapture: @escaping () -> Void = {},
        onScan: @escaping () -> Void = {}
    ) {
        _query = query
        self.onCapture = onCapture
        self.onScan = onScan
    }

    var body: some View {
        NavigationStack {
            Group {
                if loading && resources.isEmpty {
                    ProgressView("Inventar wird geladen …")
                } else if resources.isEmpty {
                    ContentUnavailableView {
                        Label(
                            hasActiveSearchOrFilters ? "Keine Ergebnisse" : "Keine Einträge",
                            systemImage: hasActiveSearchOrFilters ? "magnifyingglass" : "shippingbox"
                        )
                    } description: {
                        if hasActiveSearchOrFilters {
                            Text("Ändere die Suche oder die ausgewählten Filter.")
                        }
                    } actions: {
                        if hasActiveSearchOrFilters {
                            Button("Suche und Filter zurücksetzen") { resetSearchAndFilters() }
                        } else if state.canCreateInventory {
                            creationMenu
                                .buttonStyle(.borderedProminent)
                        }
                    }
                } else {
                    List {
                        Section {
                            ForEach(resources) { resource in
                                inventoryListRow(resource)
                            }
                            if loadingMore {
                                HStack {
                                    Spacer()
                                    ProgressView()
                                    Spacer()
                                }
                            }
                        } footer: {
                            Text(resultCountLabel)
                        }
                    }
                    .listStyle(.plain)
                    .refreshable { await load(reset: true) }
                }
            }
            .navigationTitle("Inventar")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    filterMenu
                }

                ToolbarItemGroup(placement: .topBarTrailing) {
                    if state.canCaptureInventory {
                        Button(action: onCapture) {
                            Image(systemName: "camera")
                        }
                        .accessibilityLabel("Erfassen")
                    }

                    Button(action: onScan) {
                        Image(systemName: "barcode.viewfinder")
                    }
                    .accessibilityLabel("Scannen")

                    if state.canCreateInventory {
                        Menu {
                            creationMenuActions
                        } label: {
                            Image(systemName: "plus")
                        }
                        .accessibilityLabel("Neuer Eintrag")
                    }
                }
            }
            .task(id: searchKey) {
                if !query.isEmpty {
                    try? await Task.sleep(for: .milliseconds(280))
                    guard !Task.isCancelled else { return }
                }
                await load(reset: true)
            }
            .sheet(item: $creationSheet) { destination in
                switch destination {
                case .manual:
                    ResourceFormView(resource: nil, prefilledCode: nil) {
                        didCreate($0)
                    }
                case .objectScan(let model):
                    ResourceFormView(
                        resource: nil,
                        prefilledCode: nil,
                        objectModel: model
                    ) {
                        didCreate($0)
                    }
                }
            }
            .fullScreenCover(
                isPresented: $showObjectCapture,
                onDismiss: presentFormAfterObjectCapture
            ) {
                ObjectCaptureFlowView(
                    maximumUploadImagePixelSize: state.maximumUploadImagePixelSize
                ) { model in
                    capturedObjectPendingForm = model
                } onFallback: {
                    openManualFormAfterCapture = true
                }
            }
            .alert(
                "Inventar konnte nicht geladen werden",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("Erneut laden") { Task { await load(reset: true) } }
                Button("Abbrechen", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Unbekannter Fehler")
            }
            .confirmationDialog(
                "Eintrag löschen?",
                isPresented: deletionConfirmationIsPresented,
                titleVisibility: .visible,
                presenting: resourcePendingDeletion
            ) { resource in
                Button("„\(resource.name)“ endgültig löschen", role: .destructive) {
                    Task { await delete(resource) }
                }
                Button("Abbrechen", role: .cancel) { }
            } message: { _ in
                Text("Diese Aktion kann nicht rückgängig gemacht werden.")
            }
            .alert(
                "Eintrag konnte nicht gelöscht werden",
                isPresented: Binding(
                    get: { deletionErrorMessage != nil },
                    set: { if !$0 { deletionErrorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { deletionErrorMessage = nil }
            } message: {
                Text(deletionErrorMessage ?? "Unbekannter Fehler")
            }
            .alert(
                "Favorit konnte nicht aktualisiert werden",
                isPresented: Binding(
                    get: { favoriteErrorMessage != nil },
                    set: { if !$0 { favoriteErrorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { favoriteErrorMessage = nil }
            } message: {
                Text(favoriteErrorMessage ?? "Unbekannter Fehler")
            }
        }
    }

    private var deletionConfirmationIsPresented: Binding<Bool> {
        Binding(
            get: { resourcePendingDeletion != nil },
            set: { if !$0 { resourcePendingDeletion = nil } }
        )
    }

    private var creationMenu: some View {
        Menu("Neuer Eintrag") {
            creationMenuActions
        }
    }

    @ViewBuilder
    private var creationMenuActions: some View {
        Button {
            creationSheet = .manual
        } label: {
            Label("Manuell anlegen", systemImage: "doc.badge.plus")
        }

        if state.canCaptureInventory {
            Button {
                showObjectCapture = true
            } label: {
                Label("3D-Objekt scannen", systemImage: "cube.transparent")
            }
        }
    }

    private func presentFormAfterObjectCapture() {
        if let capturedObjectPendingForm {
            self.capturedObjectPendingForm = nil
            creationSheet = .objectScan(capturedObjectPendingForm)
        } else if openManualFormAfterCapture {
            openManualFormAfterCapture = false
            creationSheet = .manual
        }
    }

    private func didCreate(_ resource: InventoryResource) {
        resources.insert(resource, at: 0)
        total += 1
        creationSheet = nil
    }

    private var filterMenu: some View {
        Menu {
            Picker("Typ", selection: $typeFilter) {
                Text("Alle Typen").tag(nil as InventoryResourceType?)
                ForEach(selectableTypeFilters, id: \.self) { type in
                    Text(type.localizedName).tag(type as InventoryResourceType?)
                }
            }

            Picker("Status", selection: $statusFilter) {
                Text("Alle Status").tag(nil as InventoryResourceStatus?)
                ForEach(InventoryResourceStatus.allCases, id: \.self) { status in
                    Text(status.localizedName).tag(status as InventoryResourceStatus?)
                }
            }

            Toggle("Nur Favoriten", isOn: $favoritesOnly)

            if hasActiveFilters {
                Divider()
                Button("Filter zurücksetzen", systemImage: "xmark.circle") {
                    typeFilter = nil
                    statusFilter = nil
                    favoritesOnly = false
                }
            }
        } label: {
            Image(
                systemName: hasActiveFilters
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle"
            )
        }
        .accessibilityLabel("Filter")
        .accessibilityValue(filterAccessibilityValue)
    }

    private func inventoryListRow(_ resource: InventoryResource) -> some View {
        NavigationLink {
            ResourceDetailView(resource: resource) { resourceID, favorite in
                updateFavoriteState(resourceID: resourceID, favorite: favorite)
            }
        } label: {
            resourceRow(resource)
        }
        .onAppear {
            if resource.id == resources.last?.id { loadNextPage() }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if state.canDeleteInventory {
                Button(role: .destructive) {
                    resourcePendingDeletion = resource
                } label: {
                    Label("Löschen", systemImage: "trash")
                }
                .disabled(deletingResourceID != nil)
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                toggleFavorite(resource)
            } label: {
                Label(
                    resource.isFavorite == true ? "Favorit entfernen" : "Als Favorit markieren",
                    systemImage: resource.isFavorite == true ? "star.slash" : "star"
                )
            }
            .tint(resource.isFavorite == true ? .gray : .yellow)
            .disabled(updatingFavoriteIDs.contains(resource.id))
        }
    }

    private func resourceRow(_ resource: InventoryResource) -> some View {
        HStack(spacing: 12) {
            Group {
                if let cover = resource.cover, let client = state.client {
                    AuthenticatedInventoryImage(media: cover, client: client)
                } else {
                    Image(systemName: resource.type.symbolName)
                        .font(.title2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.quaternary)
                }
            }
            .frame(width: 60, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(resource.name).font(.headline).lineLimit(2)
                    if resource.isFavorite == true {
                        Image(systemName: "star.fill")
                            .font(.caption)
                            .foregroundStyle(.yellow)
                            .accessibilityLabel("Favorit")
                    }
                }
                HStack(spacing: 5) {
                    Text(resource.type.localizedName)
                    if let location = resource.location, !location.isEmpty {
                        Text("·")
                        Text(location)
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                HStack {
                    Text(resource.status.localizedName)
                    Spacer()
                    Text("Bestand \(resource.quantity)").monospacedDigit()
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }

    private var hasActiveFilters: Bool {
        typeFilter != nil || statusFilter != nil || favoritesOnly
    }

    private var hasActiveSearchOrFilters: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasActiveFilters
    }

    private var filterAccessibilityValue: String {
        guard hasActiveFilters else { return "Keine Filter aktiv" }
        return [
            typeFilter?.localizedName,
            statusFilter?.localizedName,
            favoritesOnly ? "Nur Favoriten" : nil,
        ]
            .compactMap { $0 }
            .joined(separator: ", ")
    }

    private var resultCountLabel: String {
        total == 1 ? "1 Eintrag" : "\(total) Einträge"
    }

    private func resetSearchAndFilters() {
        query = ""
        typeFilter = nil
        statusFilter = nil
        favoritesOnly = false
    }

    private var searchKey: SearchKey {
        SearchKey(
            query: query,
            type: typeFilter,
            status: statusFilter,
            favoritesOnly: favoritesOnly,
            contextIdentifier: state.client?.contextIdentifier
        )
    }

    private var selectableTypeFilters: [InventoryResourceType] {
        let customTypes = Set(resources.map(\.type).filter { !$0.isBuiltIn })
            .sorted { $0.rawValue.localizedCaseInsensitiveCompare($1.rawValue) == .orderedAscending }
        return InventoryResourceType.allCases + customTypes
    }

    private func load(reset: Bool) async {
        guard let client = state.client else { return }
        if reset {
            loading = true
            page = 1
        }
        do {
            let response = try await client.listResources(
                query: query,
                type: typeFilter,
                status: statusFilter,
                favoritesOnly: favoritesOnly,
                page: reset ? 1 : page,
                pageSize: 40
            )
            if reset {
                resources = response.resources
            } else {
                let existing = Set(resources.map(\.id))
                resources.append(contentsOf: response.resources.filter { !existing.contains($0.id) })
            }
            page = response.pagination.page
            pages = response.pagination.pages
            total = response.pagination.total
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
        loadingMore = false
    }

    private func loadNextPage() {
        guard !loading, !loadingMore, page < pages else { return }
        loadingMore = true
        page += 1
        Task { await load(reset: false) }
    }

    private func delete(_ resource: InventoryResource) async {
        guard state.canDeleteInventory,
              let client = state.client,
              deletingResourceID == nil else { return }
        deletingResourceID = resource.id
        defer { deletingResourceID = nil }

        do {
            try await client.deleteResource(id: resource.id)
            withAnimation {
                resources.removeAll { $0.id == resource.id }
            }
            total = max(0, total - 1)
            pages = max(1, (total + 39) / 40)
            page = min(page, pages)
            deletionErrorMessage = nil
        } catch {
            deletionErrorMessage = error.localizedDescription
        }
    }

    private func toggleFavorite(_ resource: InventoryResource) {
        guard let client = state.client,
              !updatingFavoriteIDs.contains(resource.id) else { return }
        updatingFavoriteIDs.insert(resource.id)
        let desiredFavorite = resource.isFavorite != true
        Task {
            defer { updatingFavoriteIDs.remove(resource.id) }
            do {
                let response = try await client.setResourceFavorite(
                    resourceID: resource.id,
                    favorite: desiredFavorite
                )
                withAnimation {
                    updateFavoriteState(
                        resourceID: resource.id,
                        favorite: response.favorite
                    )
                }
                favoriteErrorMessage = nil
            } catch {
                favoriteErrorMessage = error.localizedDescription
            }
        }
    }

    private func updateFavoriteState(resourceID: UUID, favorite: Bool) {
        guard let index = resources.firstIndex(where: { $0.id == resourceID }) else { return }
        if favoritesOnly && !favorite {
            resources.remove(at: index)
            total = max(0, total - 1)
            pages = max(1, (total + 39) / 40)
            page = min(page, pages)
        } else {
            resources[index].isFavorite = favorite
        }
    }
}

private enum InventoryCreationSheet: Identifiable {
    case manual
    case objectScan(CapturedObjectModel)

    var id: String {
        switch self {
        case .manual: "manual"
        case .objectScan(let model): "object-scan-\(model.id.uuidString)"
        }
    }
}

private struct SearchKey: Hashable {
    let query: String
    let type: InventoryResourceType?
    let status: InventoryResourceStatus?
    let favoritesOnly: Bool
    let contextIdentifier: String?
}

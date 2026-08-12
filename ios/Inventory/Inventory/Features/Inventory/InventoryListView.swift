import SwiftUI

struct InventoryListView: View {
    @EnvironmentObject private var state: AppState
    @Binding private var searchRequested: Bool
    private let onCapture: () -> Void
    private let onScan: () -> Void
    @State private var resources: [InventoryResource] = []
    @State private var query = ""
    @State private var searchPresented = false
    @State private var typeFilter: InventoryResourceType?
    @State private var statusFilter: InventoryResourceStatus?
    @State private var page = 1
    @State private var pages = 1
    @State private var total = 0
    @State private var loading = false
    @State private var loadingMore = false
    @State private var errorMessage: String?
    @State private var showNewResource = false

    init(
        searchRequested: Binding<Bool> = .constant(false),
        onCapture: @escaping () -> Void = {},
        onScan: @escaping () -> Void = {}
    ) {
        _searchRequested = searchRequested
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
                        Label("Keine Einträge", systemImage: "shippingbox")
                    } description: {
                        EmptyView()
                    } actions: {
                        Button("Neuer Eintrag") { showNewResource = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 11) {
                            ForEach(resources) { resource in
                                NavigationLink {
                                    ResourceDetailView(resource: resource)
                                } label: {
                                    resourceRow(resource)
                                }
                                .buttonStyle(.plain)
                                .onAppear {
                                    if resource.id == resources.last?.id { loadNextPage() }
                                }
                            }
                            if loadingMore { ProgressView().padding() }
                        }
                        .padding(16)
                    }
                    .refreshable { await load(reset: true) }
                }
            }
            .background(InventoryTheme.canvas)
            .navigationTitle("Inventar")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $query,
                isPresented: $searchPresented,
                prompt: "Name, SKU, Tag oder Ort"
            )
            .safeAreaInset(edge: .top, spacing: 0) { filterBar }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button(action: onCapture) {
                        Image(systemName: "camera.fill")
                    }
                    .accessibilityLabel("Erfassen")

                    Button(action: onScan) {
                        Image(systemName: "barcode.viewfinder")
                    }
                    .accessibilityLabel("Scannen")

                    Button { showNewResource = true } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Neuer Eintrag")
                }
            }
            .onChange(of: searchRequested) { _, requested in
                guard requested else { return }
                searchPresented = true
                searchRequested = false
            }
            .task(id: searchKey) {
                if !query.isEmpty {
                    try? await Task.sleep(for: .milliseconds(280))
                    guard !Task.isCancelled else { return }
                }
                await load(reset: true)
            }
            .sheet(isPresented: $showNewResource) {
                ResourceFormView(resource: nil, prefilledCode: nil) { resource in
                    resources.insert(resource, at: 0)
                    total += 1
                    showNewResource = false
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
        }
    }

    private var filterBar: some View {
        HStack(spacing: 8) {
            Menu {
                Button("Alle Typen") { typeFilter = nil }
                ForEach(selectableTypeFilters, id: \.self) { type in
                    Button(type.localizedName) { typeFilter = type }
                }
            } label: {
                filterPill(typeFilter?.localizedName ?? "Alle Typen", active: typeFilter != nil)
            }

            Menu {
                Button("Alle Status") { statusFilter = nil }
                ForEach(InventoryResourceStatus.allCases, id: \.self) { status in
                    Button(status.localizedName) { statusFilter = status }
                }
            } label: {
                filterPill(statusFilter?.localizedName ?? "Alle Status", active: statusFilter != nil)
            }

            Spacer()
            Text("\(total)")
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(.ultraThinMaterial)
    }

    private func filterPill(_ label: String, active: Bool) -> some View {
        HStack(spacing: 5) {
            Text(label)
            Image(systemName: "chevron.down").font(.caption2.bold())
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(active ? InventoryTheme.ink : .secondary)
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .background(active ? InventoryTheme.lime.opacity(0.65) : Color.secondary.opacity(0.1), in: Capsule())
    }

    private func resourceRow(_ resource: InventoryResource) -> some View {
        HStack(spacing: 13) {
            Group {
                if let cover = resource.cover, let client = state.client {
                    AuthenticatedInventoryImage(media: cover, client: client)
                } else {
                    Image(systemName: resource.type.symbolName)
                        .font(.title2)
                        .foregroundStyle(InventoryTheme.ink.opacity(0.5))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(InventoryTheme.accent.opacity(0.12))
                }
            }
            .frame(width: 76, height: 76)
            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                Text(resource.name).font(.headline).lineLimit(2)
                HStack(spacing: 7) {
                    Text(resource.type.localizedName)
                    if let location = resource.location, !location.isEmpty {
                        Text("·")
                        Label(location, systemImage: "mappin").labelStyle(.titleOnly)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                HStack {
                    Text(resource.status.localizedName)
                    Spacer()
                    Text("Bestand \(resource.quantity)").monospacedDigit()
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
        }
        .inventoryCard()
    }

    private var searchKey: SearchKey {
        SearchKey(query: query, type: typeFilter, status: statusFilter)
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
}

private struct SearchKey: Hashable {
    let query: String
    let type: InventoryResourceType?
    let status: InventoryResourceStatus?
}

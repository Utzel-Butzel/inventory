import MapKit
import SwiftUI

struct InventoryMapView: View {
    @EnvironmentObject private var state: AppState

    @State private var resources: [InventoryResource] = []
    @State private var query = ""
    @State private var selectedResourceID: UUID?
    @State private var cameraPosition: MapCameraPosition = .automatic
    @State private var loading = false
    @State private var hasLoaded = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                map

                if loading && !hasLoaded {
                    loadingOverlay
                } else if filteredResources.isEmpty {
                    unavailableOverlay(
                        title: queryTerms.isEmpty ? L10n.text("ui_no_items_35719c23") : L10n.text("ui_no_matches_6df7e9f7"),
                        description: queryTerms.isEmpty
                            ? L10n.text("ui_captured_inventory_will_appear_here_4d4f188f")
                            : L10n.text("ui_adjust_the_search_term_eda746bc")
                    )
                } else if positionedResources.isEmpty {
                    unavailableOverlay(
                        title: L10n.text("ui_no_map_locations_09ad3255"),
                        description: L10n.text("ui_the_matching_items_do_not_have_gps_b4d2d444")
                    )
                }
            }
            .background(InventoryTheme.canvas)
            .navigationTitle(L10n.text("ui_map_36a8c499"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: L10n.text("ui_name_sku_tag_or_location_a7c32941"))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await loadResources() }
                    } label: {
                        if loading {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(loading)
                    .accessibilityLabel(L10n.text("ui_refresh_map_95a65088"))
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 8) {
                footer
            }
            .task(id: state.client?.contextIdentifier) {
                await loadResources()
            }
            .onChange(of: query) { _, _ in
                if let selectedResourceID,
                   !positionedResources.contains(where: { $0.id == selectedResourceID }) {
                    self.selectedResourceID = nil
                }
                cameraPosition = .automatic
            }
            .alert(
                L10n.text("ui_could_not_load_map_7837f152"),
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button(L10n.text("ui_retry_1b8b908f")) { Task { await loadResources() } }
                Button(L10n.text("ui_cancel_f7ff1178"), role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? L10n.text("ui_unknown_error_617580f0"))
            }
        }
    }

    private var map: some View {
        Map(position: $cameraPosition, selection: $selectedResourceID) {
            ForEach(positionedResources) { item in
                Marker(
                    item.resource.name,
                    systemImage: item.resource.type.symbolName,
                    coordinate: item.coordinate
                )
                .tint(item.resource.status.tint)
                .tag(item.id)
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .ignoresSafeArea(edges: .bottom)
    }

    @ViewBuilder
    private var footer: some View {
        if hasLoaded && (!filteredResources.isEmpty || selectedResource != nil) {
            VStack(spacing: 8) {
                if unpositionedCount > 0 {
                    Label(
                        unpositionedCount == 1
                            ? L10n.text("ui_1_result_without_gps_is_not_shown_a12489a9")
                            : L10n.text("ui_0_results_without_gps_are_not_shown_9dbb6dfa", unpositionedCount),
                        systemImage: "location.slash.fill"
                    )
                    .font(.caption.weight(.medium))
                    .foregroundStyle(InventoryTheme.warning)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                }

                if let selectedResource {
                    NavigationLink {
                        ResourceDetailView(resource: selectedResource)
                    } label: {
                        selectedResourceCard(selectedResource)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
        }
    }

    private var loadingOverlay: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text(L10n.text("ui_loading_map_locations_c19f04c2"))
                .font(.subheadline.weight(.medium))
        }
        .padding(20)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func unavailableOverlay(title: String, description: String) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: "map")
        } description: {
            Text(description)
        }
        .padding(24)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(24)
    }

    private func selectedResourceCard(_ resource: InventoryResource) -> some View {
        HStack(spacing: 12) {
            Group {
                if let cover = resource.cover, let client = state.client {
                    AuthenticatedInventoryImage(media: cover, client: client)
                } else {
                    Image(systemName: resource.type.symbolName)
                        .font(.title2)
                        .foregroundStyle(InventoryTheme.ink.opacity(0.65))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(InventoryTheme.accent.opacity(0.12))
                }
            }
            .frame(width: 58, height: 58)
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(resource.name)
                    .font(.headline)
                    .foregroundStyle(InventoryTheme.ink)
                    .lineLimit(1)

                HStack(spacing: 5) {
                    Text(resource.status.localizedName)
                        .foregroundStyle(resource.status.tint)
                    if let location = resource.location, !location.isEmpty {
                        Text("·")
                        Text(location)
                    }
                }
                .font(.caption.weight(.medium))
                .lineLimit(1)

                Text(L10n.text("ui_stock_0_7d245045", resource.quantity))
                    .font(.caption2.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.primary.opacity(0.08), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.08), radius: 12, y: 5)
    }

    private var queryTerms: [String] {
        query
            .split(whereSeparator: \.isWhitespace)
            .map { normalized(String($0)) }
            .filter { !$0.isEmpty }
    }

    private var filteredResources: [InventoryResource] {
        guard !queryTerms.isEmpty else { return resources }
        return resources.filter { resource in
            let searchable = normalized(
                [
                    resource.name,
                    resource.description,
                    resource.sku ?? "",
                    resource.serialNumber ?? "",
                    resource.location ?? "",
                    resource.type.localizedName,
                    resource.status.localizedName,
                    resource.tags.joined(separator: " "),
                    resource.categories.map(\.name).joined(separator: " "),
                ]
                .joined(separator: " ")
            )
            return queryTerms.allSatisfy(searchable.contains)
        }
    }

    private var positionedResources: [PositionedResource] {
        filteredResources.compactMap { PositionedResource(resource: $0) }
    }

    private var unpositionedCount: Int {
        filteredResources.count - positionedResources.count
    }

    private var selectedResource: InventoryResource? {
        guard let selectedResourceID else { return nil }
        return positionedResources.first(where: { $0.id == selectedResourceID })?.resource
    }

    private func normalized(_ value: String) -> String {
        value.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: .current
        )
    }

    @MainActor
    private func loadResources() async {
        guard !loading, let client = state.client else { return }
        loading = true
        defer { loading = false }

        do {
            var loaded: [InventoryResource] = []
            var seen = Set<UUID>()
            var page = 1
            var pages = 1

            repeat {
                try Task.checkCancellation()
                let response = try await client.listResources(page: page, pageSize: 100)
                for resource in response.resources where seen.insert(resource.id).inserted {
                    loaded.append(resource)
                }
                pages = max(1, response.pagination.pages)
                page += 1
            } while page <= pages

            resources = loaded
            hasLoaded = true
            errorMessage = nil
            if let selectedResourceID,
               !loaded.contains(where: { $0.id == selectedResourceID }) {
                self.selectedResourceID = nil
            }
            cameraPosition = .automatic
        } catch is CancellationError {
            return
        } catch {
            hasLoaded = true
            errorMessage = error.localizedDescription
        }
    }
}

private struct PositionedResource: Identifiable {
    let resource: InventoryResource
    let coordinate: CLLocationCoordinate2D

    var id: UUID { resource.id }

    init?(resource: InventoryResource) {
        guard let latitude = resource.gpsLatitude,
              let longitude = resource.gpsLongitude,
              latitude.isFinite,
              longitude.isFinite,
              (-90 ... 90).contains(latitude),
              (-180 ... 180).contains(longitude)
        else {
            return nil
        }
        self.resource = resource
        self.coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

import SwiftUI

struct ResourcePickerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: AppState

    let title: String
    let excludedResourceIDs: Set<UUID>
    let onSelect: (InventoryResource) -> Void

    @State private var query = ""
    @State private var resources: [InventoryResource] = []
    @State private var loading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if loading && resources.isEmpty {
                ProgressView("Inventar wird geladen …")
                    .frame(maxWidth: .infinity)
            } else if resources.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                ForEach(resources) { resource in
                    Button {
                        onSelect(resource)
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: resource.type.symbolName)
                                .foregroundStyle(InventoryTheme.accent)
                                .frame(width: 30)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(resource.name)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.primary)
                                Text(resourcePickerSubtitle(resource))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(resource.quantity)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Name, SKU oder Barcode")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Abbrechen") { dismiss() }
            }
        }
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            guard !Task.isCancelled, let client = state.client else { return }
            loading = true
            errorMessage = nil
            defer { loading = false }
            do {
                let response = try await client.listResources(
                    query: query,
                    page: 1,
                    pageSize: 100
                )
                resources = response.resources.filter {
                    !excludedResourceIDs.contains($0.id) && $0.status != .archived
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func resourcePickerSubtitle(_ resource: InventoryResource) -> String {
        [resource.sku, resource.barcode, resource.type.localizedName]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

struct ResourceDetailLoaderView: View {
    @EnvironmentObject private var state: AppState
    let resourceID: UUID

    @State private var resource: InventoryResource?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let resource {
                ResourceDetailView(resource: resource)
            } else if let errorMessage {
                ContentUnavailableView(
                    "Eintrag nicht verfügbar",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
            } else {
                ProgressView("Eintrag wird geladen …")
            }
        }
        .task {
            guard resource == nil, let client = state.client else { return }
            do {
                resource = try await client.getResource(id: resourceID)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

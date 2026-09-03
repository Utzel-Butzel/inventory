import SwiftUI
import UIKit
import ImageIO
import QuickLook

private struct PendingStockAction: Sendable {
    let id: UUID
    let delta: Int
    let type: String
    let reason: String
}

struct ResourceDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: AppState
    @State private var current: InventoryResource
    @State private var showEditor = false
    @State private var showStockCounter = false
    @State private var showStockManagement = false
    @State private var booking = false
    @State private var updatingFavorite = false
    @State private var confirmIssue = false
    @State private var pendingStockAction: PendingStockAction?
    @State private var errorMessage: String?
    @State private var modelDownloadID: UUID?
    @State private var downloadedModel: DownloadedObjectModel?
    @State private var modelErrorMessage: String?
    @State private var inventoryTypes: [InventoryTypeDefinition] = []
    @State private var customFieldDefinitions: [CustomFieldDefinition] = []
    @State private var resourceAccess: InventoryResourceAccess?
    private let onFavoriteChanged: ((UUID, Bool) -> Void)?

    init(
        resource: InventoryResource,
        onFavoriteChanged: ((UUID, Bool) -> Void)? = nil
    ) {
        _current = State(initialValue: resource)
        self.onFavoriteChanged = onFavoriteChanged
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                hero
                identityCard
                stockCard
                if canReadCurrentAssignments { assignmentsCard }
                if !current.description.isEmpty { descriptionCard }
                if hasAdditionalDetails { additionalDetailsCard }
                if !(current.customFields ?? [:]).isEmpty { customFieldsCard }
                structureCard
                mediaSection
                if !current.tags.isEmpty || !current.categories.isEmpty { tagsSection }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .background(InventoryTheme.canvas)
        .navigationTitle(current.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    toggleFavorite()
                } label: {
                    Image(systemName: current.isFavorite == true ? "star.fill" : "star")
                }
                .foregroundStyle(current.isFavorite == true ? .yellow : .primary)
                .disabled(updatingFavorite)
                .accessibilityLabel(
                    current.isFavorite == true ? "Favorit entfernen" : "Als Favorit markieren"
                )

                if canUpdateCurrentResource {
                    Button("Bearbeiten") { showEditor = true }
                }
            }
        }
        .task {
            await refresh()
            await loadMetadata()
        }
        .sheet(isPresented: $showEditor, onDismiss: {
            Task { await refresh() }
        }) {
            ResourceFormView(
                resource: current,
                prefilledCode: nil,
                resourceAccess: resourceAccess,
                onSaved: {
                    current = $0
                    showEditor = false
                },
                onDeleted: {
                    showEditor = false
                    dismiss()
                }
            )
        }
        .fullScreenCover(isPresented: $showStockCounter) {
            UnifiedCameraView(
                initialMode: .count,
                maximumUploadImagePixelSize: state.maximumUploadImagePixelSize,
                initialCountResource: current,
                onClose: { showStockCounter = false },
                onSubmit: { state.intakeQueue.enqueue($0) },
                onCountApplied: { updated in
                    current = updated
                    showStockCounter = false
                }
            )
            .tint(InventoryTheme.accent)
        }
        .sheet(isPresented: $showStockManagement, onDismiss: {
            Task { await refresh() }
        }) {
            StockManagementView(resource: current)
                .presentationDetents([.large])
        }
        .sheet(item: $downloadedModel) { model in
            ObjectModelPreviewSheet(model: model)
        }
        .confirmationDialog(
            "Eine Einheit aus dem Bestand entnehmen?",
            isPresented: $confirmIssue,
            titleVisibility: .visible
        ) {
            Button("1 Einheit entnehmen", role: .destructive) {
                book(delta: -1, type: "issue", reason: "Entnahme per iOS-App")
            }
            Button("Abbrechen", role: .cancel) { }
        }
        .alert(
            "Aktion fehlgeschlagen",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            if pendingStockAction != nil {
                Button("Erneut versuchen") { retryPendingStockAction() }
            }
            Button("Abbrechen", role: .cancel) {
                pendingStockAction = nil
                errorMessage = nil
            }
        } message: {
            Text(errorMessage ?? "Unbekannter Fehler")
        }
        .alert(
            "3D-Modell konnte nicht geöffnet werden",
            isPresented: Binding(
                get: { modelErrorMessage != nil },
                set: { if !$0 { modelErrorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { modelErrorMessage = nil }
        } message: {
            Text(modelErrorMessage ?? "Unbekannter Fehler")
        }
    }

    private var hero: some View {
        Group {
            if let cover = current.cover, let client = state.client {
                AuthenticatedInventoryImage(media: cover, client: client)
            } else {
                ZStack {
                    LinearGradient(
                        colors: [InventoryTheme.accent.opacity(0.25), InventoryTheme.canvas],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: current.type.symbolName)
                        .font(.system(size: 58, weight: .light))
                        .foregroundStyle(InventoryTheme.ink.opacity(0.45))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(1.4, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private var identityCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(typeLabel, systemImage: current.type.symbolName)
                Spacer()
                Text(current.status.localizedName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(current.status.tint)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(current.status.tint.opacity(0.12), in: Capsule())
            }
            .font(.subheadline.weight(.medium))

            if let sku = current.sku {
                LabeledContent("SKU", value: sku)
            }
            if let barcode = current.barcode {
                LabeledContent("Barcode", value: barcode)
            }
            if let serial = current.serialNumber {
                LabeledContent("Seriennummer", value: serial)
            }
            if let location = current.location {
                LabeledContent("Ort", value: location)
            }
        }
        .inventoryCard()
    }

    private var stockCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Bestand", systemImage: "shippingbox.fill").font(.headline)
                Spacer()
                Text("\(current.quantity)")
                    .font(.title2.monospacedDigit().bold())
            }
            if canManageCurrentStock {
                HStack(spacing: 12) {
                    Button {
                        confirmIssue = true
                    } label: {
                        Label("Entnehmen", systemImage: "minus.circle.fill")
                            .frame(maxWidth: .infinity, minHeight: 42)
                    }
                    .buttonStyle(.bordered)
                    .disabled(booking || (current.quantity <= 0 && !state.allowsNegativeStock))

                    Button {
                        book(delta: 1, type: "receipt", reason: "Zugang per iOS-App")
                    } label: {
                        Label("Zugang", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity, minHeight: 42)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(InventoryTheme.ink)
                    .disabled(booking)
                }

                Button {
                    showStockManagement = true
                } label: {
                    Label("Bestand verwalten", systemImage: "slider.horizontal.3")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(InventoryTheme.ink)
                .disabled(booking)

                Divider()

                Button {
                    showStockCounter = true
                } label: {
                    Label("Teile per Foto zählen", systemImage: "camera.viewfinder")
                        .frame(maxWidth: .infinity, minHeight: 42)
                }
                .buttonStyle(.bordered)
                .tint(InventoryTheme.ink)
                .disabled(booking || !canUseAIForCurrentResource)
            }

            if canManageCurrentStock && !canUseAIForCurrentResource {
                Label(
                    "Die Fotozählung benötigt die KI-Berechtigung für dieses Konto.",
                    systemImage: "lock.fill"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            if booking { ProgressView().frame(maxWidth: .infinity) }
        }
        .inventoryCard()
    }

    private var descriptionCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Beschreibung").font(.headline)
            Text(current.description)
                .font(.body)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .inventoryCard()
    }

    private var assignmentsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Ausleihen & Zuweisungen", systemImage: "person.crop.circle.badge.clock")
                .font(.headline)
            Text("Empfänger, Reservierungen und Rückgaben für diesen Eintrag verwalten.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            NavigationLink {
                ResourceAssignmentsView(
                    resourceID: current.id,
                    canEdit: canManageCurrentAssignments,
                    onInventoryChanged: { Task { await refresh() } }
                )
            } label: {
                Label("Nutzung verwalten", systemImage: "arrow.right.circle.fill")
                    .frame(maxWidth: .infinity, minHeight: 42)
            }
            .buttonStyle(.borderedProminent)
            .tint(InventoryTheme.ink)
        }
        .inventoryCard()
    }

    @ViewBuilder
    private var mediaSection: some View {
        if let client = state.client, !imageMedia.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Bilder").font(.headline)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(imageMedia) { media in
                            AuthenticatedInventoryImage(media: media, client: client)
                                .frame(width: 150, height: 150)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                    }
                }
            }
        }

        if !objectModels.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label("3D-Objektscan", systemImage: "cube.transparent.fill")
                    .font(.headline)
                ForEach(objectModels) { media in
                    objectModelCard(media)
                }
            }
            .inventoryCard()
        }
    }

    private var imageMedia: [InventoryMedia] {
        current.media.filter {
            $0.kind == .image && $0.id != current.cover?.id
        }
    }

    private var objectModels: [InventoryMedia] {
        current.media.filter {
            $0.kind == .model ||
                $0.mimeType == CapturedObjectModel.mimeType ||
                $0.name.lowercased().hasSuffix(".usdz")
        }
    }

    private func objectModelCard(_ media: InventoryMedia) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "cube.fill")
                .font(.title2)
                .foregroundStyle(InventoryTheme.accent)
                .frame(width: 44, height: 44)
                .background(
                    InventoryTheme.accent.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 3) {
                Text(media.name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                Text(media.size.map { $0.formatted(.byteCount(style: .file)) } ?? "USDZ-Modell")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                openObjectModel(media)
            } label: {
                if modelDownloadID == media.id {
                    ProgressView().controlSize(.small)
                } else {
                    Label("Öffnen", systemImage: "arkit")
                        .labelStyle(.iconOnly)
                }
            }
            .buttonStyle(.bordered)
            .disabled(modelDownloadID != nil || state.client == nil)
            .accessibilityLabel("3D-Modell öffnen")
        }
    }

    private var tagsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !current.categories.isEmpty {
                Text("Kategorien").font(.headline)
                FlowLayout(spacing: 7) {
                    ForEach(current.categories, id: \.name) { category in
                        Text(category.name)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(InventoryTheme.accent.opacity(0.12), in: Capsule())
                    }
                }
            }
            if !current.tags.isEmpty {
                Text("Tags").font(.headline)
                FlowLayout(spacing: 7) {
                    ForEach(current.tags, id: \.self) { tag in
                        Text(tag)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(.secondary.opacity(0.1), in: Capsule())
                    }
                }
            }
        }
        .inventoryCard()
    }

    private func refresh() async {
        guard let client = state.client else { return }
        do {
            let response = try await client.getResourceDetail(id: current.id)
            current = response.resource
            resourceAccess = response.access
            onFavoriteChanged?(current.id, current.isFavorite == true)
        } catch { }
    }

    private var typeLabel: String {
        inventoryTypes.first(where: { $0.key == current.type.rawValue })?.label
            ?? current.type.localizedName
    }

    private var hasAdditionalDetails: Bool {
        current.valueCents != nil || current.priority != 3 ||
            current.gpsLatitude != nil || current.gpsLongitude != nil ||
            current.gpsAltitude != nil || !current.notes.isEmpty
    }

    private var additionalDetailsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Weitere Angaben").font(.headline)
            if let valueCents = current.valueCents {
                LabeledContent(
                    "Wert",
                    value: (Double(valueCents) / 100).formatted(
                        .currency(code: current.currency)
                    )
                )
            }
            if current.priority != 3 {
                LabeledContent("Priorität", value: "\(current.priority)")
            }
            if let latitude = current.gpsLatitude {
                LabeledContent("Breitengrad", value: latitude.formatted())
            }
            if let longitude = current.gpsLongitude {
                LabeledContent("Längengrad", value: longitude.formatted())
            }
            if let altitude = current.gpsAltitude {
                LabeledContent("Höhe", value: "\(altitude.formatted()) m")
            }
            if !current.notes.isEmpty {
                Divider()
                Text(current.notes)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .inventoryCard()
    }

    private var customFieldsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Benutzerdefinierte Felder").font(.headline)
            ForEach((current.customFields ?? [:]).keys.sorted(), id: \.self) { key in
                if let value = current.customFields?[key] {
                    LabeledContent(customFieldLabel(for: key), value: display(value))
                }
            }
        }
        .inventoryCard()
    }

    private var structureCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Struktur")
                .font(.headline)
                .padding(.bottom, 6)

            structureLink(
                title: "Varianten",
                subtitle: "Produktfamilie und Varianten verwalten",
                systemImage: "square.stack.3d.up"
            ) {
                ResourceFamilyView(
                    resourceID: current.id,
                    canEdit: canUpdateCurrentResource,
                    canCreate: canUpdateCurrentResource && state.canCreateInventory
                )
            }
            Divider().padding(.leading, 42)
            structureLink(
                title: "Beziehungen",
                subtitle: "Verknüpfte Inventareinträge anzeigen",
                systemImage: "link"
            ) {
                ResourceRelationsView(
                    resourceID: current.id,
                    canEdit: canUpdateCurrentResource
                )
            }
            Divider().padding(.leading, 42)
            structureLink(
                title: "Stückliste",
                subtitle: "Komponenten und baubare Menge verwalten",
                systemImage: "list.bullet.rectangle"
            ) {
                BillOfMaterialsView(
                    resourceID: current.id,
                    canEdit: canUpdateCurrentResource
                )
            }
        }
        .inventoryCard()
    }

    private func structureLink<Destination: View>(
        title: String,
        subtitle: String,
        systemImage: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink(destination: destination) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .foregroundStyle(InventoryTheme.accent)
                    .frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 9)
        }
    }

    private func customFieldLabel(for key: String) -> String {
        customFieldDefinitions.first(where: { $0.key == key })?.label ?? key
    }

    private func display(_ value: CustomFieldValue) -> String {
        switch value {
        case .string(let value): value
        case .number(let value): value.formatted()
        case .boolean(let value): value ? "Ja" : "Nein"
        case .strings(let values): values.joined(separator: ", ")
        }
    }

    private func loadMetadata() async {
        guard let client = state.client else { return }
        inventoryTypes = (try? await client.inventoryTypes().types) ?? []
        customFieldDefinitions = (
            try? await client.customFieldDefinitions(entityType: .inventory).definitions
        ) ?? []
    }

    private func openObjectModel(_ media: InventoryMedia) {
        guard let client = state.client, modelDownloadID == nil else { return }
        modelDownloadID = media.id
        modelErrorMessage = nil
        Task {
            defer { modelDownloadID = nil }
            var downloadedFileURL: URL?
            do {
                let fileURL = try await client.mediaFile(for: media)
                downloadedFileURL = fileURL
                try Task.checkCancellation()
                downloadedModel = DownloadedObjectModel(
                    name: media.name,
                    fileURL: fileURL
                )
                downloadedFileURL = nil // The preview sheet now owns cleanup.
            } catch is CancellationError {
                if let downloadedFileURL {
                    try? FileManager.default.removeItem(
                        at: downloadedFileURL.deletingLastPathComponent()
                    )
                }
                return
            } catch {
                if let downloadedFileURL {
                    try? FileManager.default.removeItem(
                        at: downloadedFileURL.deletingLastPathComponent()
                    )
                }
                modelErrorMessage = error.localizedDescription
            }
        }
    }

    private func book(delta: Int, type: String, reason: String) {
        guard canManageCurrentStock else { return }
        let action = PendingStockAction(
            id: UUID(),
            delta: delta,
            type: type,
            reason: reason
        )
        pendingStockAction = action
        performStockAction(action)
    }

    private func toggleFavorite() {
        guard let client = state.client, !updatingFavorite else { return }
        updatingFavorite = true
        let desiredFavorite = current.isFavorite != true
        Task {
            defer { updatingFavorite = false }
            do {
                let response = try await client.setResourceFavorite(
                    resourceID: current.id,
                    favorite: desiredFavorite
                )
                current.isFavorite = response.favorite
                onFavoriteChanged?(current.id, response.favorite)
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func retryPendingStockAction() {
        guard let action = pendingStockAction else { return }
        errorMessage = nil
        performStockAction(action)
    }

    private func performStockAction(_ action: PendingStockAction) {
        guard canManageCurrentStock, let client = state.client else { return }
        booking = true
        Task {
            do {
                _ = try await client.bookStockMovement(
                    resourceID: current.id,
                    delta: action.delta,
                    type: action.type,
                    reason: action.reason,
                    location: current.location,
                    idempotencyKey: action.id
                )
                current = try await client.getResource(id: current.id)
                pendingStockAction = nil
            } catch {
                errorMessage = error.localizedDescription
            }
            booking = false
        }
    }

    private var canUpdateCurrentResource: Bool {
        state.canUpdateInventory && (resourceAccess?.update ?? true)
    }

    private var canManageCurrentStock: Bool {
        state.canManageStock && (resourceAccess?.stock ?? true)
    }

    private var canReadCurrentAssignments: Bool {
        state.canReadAssignments && (resourceAccess?.assignments ?? true)
    }

    private var canManageCurrentAssignments: Bool {
        state.canManageAssignments && (resourceAccess?.assignments ?? true)
    }

    private var canUseAIForCurrentResource: Bool {
        state.canUseAI && (resourceAccess?.ai ?? true)
    }
}

private struct DownloadedObjectModel: Identifiable {
    let id = UUID()
    let name: String
    let fileURL: URL

    func removeLocalFile() {
        try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
    }
}

private struct ObjectModelPreviewSheet: View {
    let model: DownloadedObjectModel

    var body: some View {
        NavigationStack {
            ObjectModelQuickLook(fileURL: model.fileURL)
                .navigationTitle(model.name)
                .navigationBarTitleDisplayMode(.inline)
        }
        .onDisappear { model.removeLocalFile() }
    }
}

private struct ObjectModelQuickLook: UIViewControllerRepresentable {
    let fileURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(fileURL: fileURL)
    }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(
        _ uiViewController: QLPreviewController,
        context: Context
    ) {
        context.coordinator.fileURL = fileURL
        uiViewController.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var fileURL: URL

        init(fileURL: URL) {
            self.fileURL = fileURL
        }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> QLPreviewItem {
            fileURL as NSURL
        }
    }
}

private actor InventoryImageDataCache {
    static let shared = InventoryImageDataCache()
    private let maximumByteCount = 48 * 1_024 * 1_024
    private var values: [String: Data] = [:]
    private var recency: [String] = []
    private var byteCount = 0

    func value(for key: String) -> Data? {
        guard let data = values[key] else { return nil }
        recency.removeAll { $0 == key }
        recency.append(key)
        return data
    }

    func insert(_ data: Data, for key: String) {
        if let previous = values.updateValue(data, forKey: key) {
            byteCount -= previous.count
        }
        byteCount += data.count
        recency.removeAll { $0 == key }
        recency.append(key)
        while byteCount > maximumByteCount, let oldest = recency.first {
            recency.removeFirst()
            if let removed = values.removeValue(forKey: oldest) {
                byteCount -= removed.count
            }
        }
    }
}

struct AuthenticatedInventoryImage: View {
    let media: InventoryMedia
    let client: APIClient
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Rectangle().fill(.secondary.opacity(0.1))
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ProgressView()
            }
        }
        .clipped()
        .task(id: cacheKey) {
            if let cached = await InventoryImageDataCache.shared.value(for: cacheKey) {
                image = Self.downsampledImage(from: cached)
                return
            }
            do {
                let data = try await client.mediaData(for: media)
                try Task.checkCancellation()
                await InventoryImageDataCache.shared.insert(data, for: cacheKey)
                image = Self.downsampledImage(from: data)
            } catch { }
        }
    }

    private var cacheKey: String {
        "\(client.contextIdentifier)|\(media.id.uuidString)|\(media.url)"
    }

    private static func downsampledImage(from data: Data) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 1_200,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(
            source,
            CGImageSourceGetPrimaryImageIndex(source),
            options as CFDictionary
        ) else { return nil }
        return UIImage(cgImage: thumbnail)
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        layout(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, point) in result.points.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        let width = proposal.width ?? 320
        var points: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: width, height: y + rowHeight), points)
    }
}

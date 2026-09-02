import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct PendingResourceMedia: Identifiable, Equatable {
    let id: UUID
    let file: MediaUploadFile

    init(id: UUID = UUID(), file: MediaUploadFile) {
        self.id = id
        self.file = file
    }

    func removeLocalFile() {
        try? FileManager.default.removeItem(at: file.fileURL)
    }
}

struct ResourceMediaEditorSection: View {
    let resourceID: UUID
    let client: APIClient?
    let maximumImagePixelSize: Int
    let disabled: Bool
    @Binding var media: [InventoryMedia]
    @Binding var pendingUploads: [PendingResourceMedia]
    @Binding var busy: Bool
    let reportError: (String) -> Void
    let onUpdated: (InventoryResource) -> Void

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showFileImporter = false
    @State private var mediaPendingDeletion: InventoryMedia?

    var body: some View {
        Section("Medien") {
            if media.isEmpty && pendingUploads.isEmpty {
                Label("Noch keine Medien vorhanden", systemImage: "photo.on.rectangle")
                    .foregroundStyle(.secondary)
            }

            ForEach(Array(media.enumerated()), id: \.element.id) { index, item in
                existingMediaRow(item, at: index)
            }

            ForEach(pendingUploads) { item in
                pendingMediaRow(item)
            }

            PhotosPicker(
                selection: $pickerItems,
                maxSelectionCount: max(1, 12 - pendingUploads.count),
                matching: .images
            ) {
                Label("Fotos hinzufügen", systemImage: "photo.badge.plus")
            }
            .disabled(disabled || busy || pendingUploads.count >= 12)

            Button {
                showFileImporter = true
            } label: {
                Label("Video, PDF oder USDZ hinzufügen", systemImage: "paperclip")
            }
            .disabled(disabled || busy || pendingUploads.count >= 12)

            if busy {
                HStack {
                    ProgressView()
                    Text("Medien werden verarbeitet …")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !pendingUploads.isEmpty {
                Text("Neue Dateien werden zusammen mit den Änderungen hochgeladen.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await preparePhotos(items) }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.movie, .pdf, .data],
            allowsMultipleSelection: true,
            onCompletion: prepareImportedFiles
        )
        .confirmationDialog(
            "Medium wirklich löschen?",
            isPresented: Binding(
                get: { mediaPendingDeletion != nil },
                set: { if !$0 { mediaPendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Löschen", role: .destructive) {
                guard let item = mediaPendingDeletion else { return }
                mediaPendingDeletion = nil
                Task { await delete(item) }
            }
            Button("Abbrechen", role: .cancel) { mediaPendingDeletion = nil }
        } message: {
            Text("Die Datei wird sofort vom Server entfernt.")
        }
    }

    private func existingMediaRow(_ item: InventoryMedia, at index: Int) -> some View {
        HStack(spacing: 12) {
            mediaPreview(item)
                .frame(width: 54, height: 54)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(item.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if item.id == coverMediaID {
                        Text("Titelbild")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(InventoryTheme.accent)
                    }
                }
                Text(mediaDescription(item))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 4)

            Menu {
                Button {
                    Task { await moveMedia(at: index, by: -1) }
                } label: {
                    Label("Nach vorn", systemImage: "arrow.up")
                }
                .disabled(index == 0)

                Button {
                    Task { await moveMedia(at: index, by: 1) }
                } label: {
                    Label("Nach hinten", systemImage: "arrow.down")
                }
                .disabled(index == media.count - 1)

                Divider()

                Button(role: .destructive) {
                    mediaPendingDeletion = item
                } label: {
                    Label("Löschen", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
            }
            .disabled(disabled || busy)
            .accessibilityLabel("Aktionen für \(item.name)")
        }
    }

    private func pendingMediaRow(_ item: PendingResourceMedia) -> some View {
        HStack(spacing: 12) {
            Image(systemName: pendingMediaIcon(item.file))
                .font(.title2)
                .foregroundStyle(InventoryTheme.accent)
                .frame(width: 54, height: 54)
                .background(
                    InventoryTheme.accent.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 3) {
                Text(item.file.filename)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text("Bereit zum Hochladen")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(role: .destructive) {
                removePending(item)
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .disabled(disabled || busy)
            .accessibilityLabel("\(item.file.filename) entfernen")
        }
    }

    @ViewBuilder
    private func mediaPreview(_ item: InventoryMedia) -> some View {
        if item.kind == .image, let client {
            AuthenticatedInventoryImage(media: item, client: client)
        } else {
            Image(systemName: mediaIcon(item))
                .font(.title2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.secondary.opacity(0.1))
        }
    }

    private var coverMediaID: UUID? {
        media.first(where: { $0.kind == .image })?.id
    }

    private func mediaIcon(_ item: InventoryMedia) -> String {
        switch item.kind {
        case .image: "photo"
        case .video: "video"
        case .document: "doc"
        case .model: "cube"
        case .unknown: "paperclip"
        }
    }

    private func pendingMediaIcon(_ item: MediaUploadFile) -> String {
        if item.mimeType.hasPrefix("image/") { return "photo" }
        if item.mimeType.hasPrefix("video/") { return "video" }
        if item.mimeType == CapturedObjectModel.mimeType { return "cube" }
        return "doc"
    }

    private func mediaDescription(_ item: InventoryMedia) -> String {
        let kind: String = switch item.kind {
        case .image: "Bild"
        case .video: "Video"
        case .document: "Dokument"
        case .model: "3D-Modell"
        case .unknown: "Datei"
        }
        guard let size = item.size else { return kind }
        return "\(kind) · \(size.formatted(.byteCount(style: .file)))"
    }

    @MainActor
    private func preparePhotos(_ items: [PhotosPickerItem]) async {
        busy = true
        pickerItems = []
        defer { busy = false }

        do {
            let downsampler = try JPEGDownsampler(maximumPixelSize: maximumImagePixelSize)
            for item in items.prefix(max(0, 12 - pendingUploads.count)) {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                let destination = Self.temporaryURL(fileExtension: "jpg")
                do {
                    _ = try await downsampler.downsample(
                        encodedImageData: data,
                        destinationURL: destination
                    )
                    pendingUploads.append(
                        PendingResourceMedia(
                            file: MediaUploadFile(
                                fileURL: destination,
                                filename: "inventory-\(UUID().uuidString).jpg",
                                mimeType: "image/jpeg"
                            )
                        )
                    )
                } catch {
                    try? FileManager.default.removeItem(at: destination)
                    throw error
                }
            }
        } catch {
            reportError("Ein Foto konnte nicht vorbereitet werden: \(error.localizedDescription)")
        }
    }

    private func prepareImportedFiles(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            reportError(error.localizedDescription)
        case .success(let urls):
            do {
                for source in urls.prefix(max(0, 12 - pendingUploads.count)) {
                    let accessing = source.startAccessingSecurityScopedResource()
                    defer { if accessing { source.stopAccessingSecurityScopedResource() } }

                    let fileExtension = source.pathExtension.lowercased()
                    let contentType = UTType(filenameExtension: fileExtension)
                    let mimeType = fileExtension == "usdz"
                        ? CapturedObjectModel.mimeType
                        : contentType?.preferredMIMEType ?? "application/octet-stream"
                    guard isSupported(mimeType: mimeType, fileExtension: fileExtension) else {
                        throw APIClientError.invalidUpload(
                            "Unterstützt werden Bilder, Videos, PDF-Dateien und USDZ-Modelle."
                        )
                    }

                    let target = Self.temporaryURL(
                        fileExtension: fileExtension.isEmpty ? "bin" : fileExtension
                    )
                    do {
                        try FileManager.default.copyItem(at: source, to: target)
                        pendingUploads.append(
                            PendingResourceMedia(
                                file: MediaUploadFile(
                                    fileURL: target,
                                    filename: source.lastPathComponent,
                                    mimeType: mimeType
                                )
                            )
                        )
                    } catch {
                        try? FileManager.default.removeItem(at: target)
                        throw error
                    }
                }
            } catch {
                reportError(error.localizedDescription)
            }
        }
    }

    @MainActor
    private func moveMedia(at index: Int, by offset: Int) async {
        let destination = index + offset
        guard media.indices.contains(index), media.indices.contains(destination),
              let client else { return }
        var reordered = media
        reordered.swapAt(index, destination)
        busy = true
        defer { busy = false }
        do {
            let updated = try await client.reorderResourceMedia(
                resourceID: resourceID,
                order: reordered.map(\.id)
            )
            media = updated.media
            onUpdated(updated)
        } catch {
            reportError(error.localizedDescription)
        }
    }

    @MainActor
    private func delete(_ item: InventoryMedia) async {
        guard let client else { return }
        busy = true
        defer { busy = false }
        do {
            try await client.deleteResourceMedia(resourceID: resourceID, mediaID: item.id)
            let updated = try await client.getResource(id: resourceID)
            media = updated.media
            onUpdated(updated)
        } catch {
            reportError(error.localizedDescription)
        }
    }

    private func removePending(_ item: PendingResourceMedia) {
        pendingUploads.removeAll { $0.id == item.id }
        item.removeLocalFile()
    }

    private func isSupported(mimeType: String, fileExtension: String) -> Bool {
        mimeType.hasPrefix("image/") || mimeType.hasPrefix("video/") ||
            mimeType == "application/pdf" || fileExtension == "usdz"
    }

    private static func temporaryURL(fileExtension: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("resource-media-\(UUID().uuidString).\(fileExtension)")
    }
}
